# CloudWatch Integration

This guide covers the recommended pattern for connecting project-account CloudWatch metrics and logs to a central Grafana workspace.

## Architecture

```
Project Account (111111111111)                Shared Account (999999999999)
┌────────────────────────────────┐           ┌──────────────────────────────┐
│                                │           │                              │
│  GrafanaCloudWatchRole         │           │  Grafana Workspace           │
│  ┌──────────────────────────┐  │           │  ┌────────────────────────┐  │
│  │ IAM Role                 │◀─── sts:AssumeRole ── Service Role      │  │
│  │ - CloudWatch read        │  │           │  └────────────────────────┘  │
│  │ - CloudWatch Logs read   │  │           │                              │
│  │ - EC2 describe           │  │           │  CloudWatch Datasource       │
│  └──────────────────────────┘  │           │  (authType: assumeRole,      │
│                                │           │   assumeRoleArn: ←──────────── roleArn)
│  GrafanaDatasource ─── HTTP API ──────────▶│                              │
│                                │           │                              │
│  CloudWatch Metrics & Logs     │           │  Secrets Manager (token)     │
│  (this account's resources)    │           │                              │
└────────────────────────────────┘           └──────────────────────────────┘
```

Two resources are created in the project account:
1. **`GrafanaCloudWatchRole`** — IAM role that the Grafana workspace's service role can assume, granting read-only CloudWatch access to this account
2. **`GrafanaDatasource`** — registers the CloudWatch datasource in Grafana, pointing to this account via the IAM role

## Setup

### Prerequisites

You need the following from the central Grafana team:
- **Grafana endpoint** — e.g., `g-abc123.grafana-workspace.eu-central-1.amazonaws.com`
- **Grafana service role ARN** — the IAM role used by the Grafana workspace (e.g., `arn:aws:iam::999999999999:role/grafana-service-role`)
- **API token secret ARN** — the Secrets Manager secret containing the Grafana API token

### Implementation

```typescript
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import {
  GrafanaCloudWatchRole,
  GrafanaDatasource,
  GrafanaFolder,
  GrafanaDashboard,
} from 'cdk-grafana-resources';
import * as fs from 'fs';

const stack = new cdk.Stack(app, 'MyAppObservability', {
  env: { account: '111111111111', region: 'eu-central-1' },
});

// --- Configuration (from the central Grafana team) ---

const GRAFANA_ENDPOINT = 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com';
const GRAFANA_SERVICE_ROLE_ARN = 'arn:aws:iam::999999999999:role/grafana-service-role';

const tokenSecret = secretsmanager.Secret.fromSecretCompleteArn(
  stack, 'GrafanaToken',
  'arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/prod/service-account-token-AbCdEf',
);

// --- IAM: CloudWatch cross-account role ---

const cwRole = new GrafanaCloudWatchRole(stack, 'GrafanaCW', {
  grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
});

// --- Grafana: folder, datasource, dashboards ---

const folder = new GrafanaFolder(stack, 'Folder', {
  grafanaEndpoint: GRAFANA_ENDPOINT,
  apiTokenSecret: tokenSecret,
  uid: 'my-app-prod',
  title: 'My App — Prod',
});

new GrafanaDatasource(stack, 'CloudWatch', {
  grafanaEndpoint: GRAFANA_ENDPOINT,
  apiTokenSecret: tokenSecret,
  uid: 'my-app-cloudwatch',
  name: 'My App CloudWatch',
  type: 'cloudwatch',
  jsonDataJson: JSON.stringify({
    defaultRegion: cdk.Stack.of(stack).region,
    authType: 'assumeRole',
    assumeRoleArn: cwRole.roleArn,
  }),
});

new GrafanaDashboard(stack, 'Overview', {
  grafanaEndpoint: GRAFANA_ENDPOINT,
  apiTokenSecret: tokenSecret,
  uid: 'my-app-overview',
  folderUid: folder,
  dashboardJson: fs.readFileSync('grafana/dashboards/overview.json', 'utf-8'),
});
```

### What this creates

In the **project account** (CloudFormation):
- IAM role `GrafanaCW` trusting the Grafana service role, with CloudWatch/Logs/EC2 read-only permissions

In the **central Grafana workspace** (via HTTP API):
- Folder `my-app-prod`
- CloudWatch datasource `my-app-cloudwatch` configured to assume the cross-account role
- Dashboard `my-app-overview` in the folder

## Adding X-Ray Traces

To include X-Ray trace data in Grafana:

```typescript
const cwRole = new GrafanaCloudWatchRole(stack, 'GrafanaCW', {
  grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
  additionalActions: [
    'xray:GetTraceSummaries',
    'xray:BatchGetTraces',
    'xray:GetServiceGraph',
  ],
});
```

## Multiple Environments

For projects with separate dev and prod accounts, create a role and datasource per environment:

```typescript
interface EnvConfig {
  name: string;
  account: string;
  region: string;
}

const environments: EnvConfig[] = [
  { name: 'dev', account: '111111111111', region: 'eu-central-1' },
  { name: 'prod', account: '222222222222', region: 'eu-central-1' },
];

for (const env of environments) {
  // Each environment gets its own stack in its own account
  const envStack = new cdk.Stack(app, `MyApp-${env.name}`, {
    env: { account: env.account, region: env.region },
  });

  const cwRole = new GrafanaCloudWatchRole(envStack, 'GrafanaCW', {
    grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
  });

  const folder = new GrafanaFolder(envStack, 'Folder', {
    grafanaEndpoint: GRAFANA_ENDPOINT,
    apiTokenSecret: tokenSecret,
    uid: `my-app-${env.name}`,
    title: `My App — ${env.name}`,
  });

  new GrafanaDatasource(envStack, 'CloudWatch', {
    grafanaEndpoint: GRAFANA_ENDPOINT,
    apiTokenSecret: tokenSecret,
    uid: `my-app-${env.name}-cloudwatch`,
    name: `My App CloudWatch (${env.name})`,
    type: 'cloudwatch',
    jsonDataJson: JSON.stringify({
      defaultRegion: env.region,
      authType: 'assumeRole',
      assumeRoleArn: cwRole.roleArn,
    }),
  });
}
```

## Grafana Service Role Trust

The `GrafanaCloudWatchRole` trusts the Grafana service role via a standard IAM trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::999999999999:role/grafana-service-role"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

The Grafana workspace's service role must also have permission to call `sts:AssumeRole` on the project account's role. In AWS Managed Grafana, this is typically configured by adding the project account's role ARN to the workspace's service role policy. If you're using the [dot-grafana](https://github.com/deotio/dot-grafana) central stack, this is handled automatically.

## Ownership Model

| Resource | Owned by | Deployed to |
|---|---|---|
| Grafana workspace | Central team | Shared account |
| Grafana service role | Central team | Shared account |
| API token secret | Central team | Shared account |
| CloudWatch IAM role | Project team | Project account |
| CloudWatch datasource | Project team | Grafana workspace (via API) |
| Folders | Project team | Grafana workspace (via API) |
| Dashboards | Project team | Grafana workspace (via API) |
| Alert rules | Project team | Grafana workspace (via API) |

The central team provides the workspace, service role ARN, and token. Each project team manages everything else.

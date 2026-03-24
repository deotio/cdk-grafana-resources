# cdk-grafana-resources

AWS CDK constructs for managing Grafana dashboards, alerts, and other resources via the HTTP API.

Grafana resources participate in the full CloudFormation lifecycle — create, update, delete, and rollback — without requiring any tooling outside of `cdk deploy`.

## Install

```bash
npm install cdk-grafana-resources
```

Peer dependencies: `aws-cdk-lib` >= 2.100.0, `constructs` >= 10.0.0.

## Quick start

```typescript
import {
  GrafanaFolder,
  GrafanaDashboard,
  GrafanaAlertRule,
  GrafanaContactPoint,
  GrafanaAlertSnsIntegration,
} from 'cdk-grafana-resources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as fs from 'fs';

// Reference the Grafana API token stored in Secrets Manager
const token = secretsmanager.Secret.fromSecretCompleteArn(this, 'Token', tokenArn);

const folder = new GrafanaFolder(this, 'AppFolder', {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: token,
  uid: 'my-app-prod',
  title: 'My App — Prod',
});

new GrafanaDashboard(this, 'Overview', {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: token,
  uid: 'my-app-overview',
  folderUid: folder,           // auto-creates CloudFormation dependency
  dashboardJson: fs.readFileSync('grafana/dashboards/overview.json', 'utf-8'),
});
```

## Constructs

| Construct | Description |
| --- | --- |
| `GrafanaFolder` | Create and manage Grafana folders |
| `GrafanaDashboard` | Deploy dashboards with version tracking |
| `GrafanaAlertRule` | Manage Grafana-managed alert rules |
| `GrafanaContactPoint` | Configure alert notification endpoints (Slack, email, PagerDuty, etc.) |
| `GrafanaDatasource` | Register datasources (CloudWatch, Prometheus, etc.) |
| `GrafanaNotificationPolicy` | Configure the alert routing policy tree |
| `GrafanaCloudWatchRole` | IAM role granting Grafana read access to CloudWatch metrics and logs |
| `GrafanaAlertSnsIntegration` | SNS topic + Grafana contact point wired together with IAM permissions |

All constructs share a common set of base props:

```typescript
{
  grafanaEndpoint: string;           // Grafana hostname (no protocol)
  apiTokenSecret: ISecret;           // Secrets Manager secret with the API token
  grafanaApiVersion?: 'v10' | 'v11'; // API version to target (default: 'v10')
  providerProps?: GrafanaProviderProps; // Lambda config (VPC, log retention, etc.)
}
```

## Authentication

The Grafana API token must be stored as a plain string in an AWS Secrets Manager secret. The library resolves the token at deploy time — it never appears in CloudFormation state or logs.

For cross-account setups (Grafana workspace in a shared account, CDK stack in a project account), add a resource policy on the secret allowing the project account to read it.

## CloudWatch datasource

Use `GrafanaCloudWatchRole` to create an IAM role that Grafana can assume to query CloudWatch metrics and logs from the project account:

```typescript
const cwRole = new GrafanaCloudWatchRole(this, 'GrafanaCW', {
  grafanaServiceRoleArn: 'arn:aws:iam::999999999999:role/grafana-service-role',
});

new GrafanaDatasource(this, 'CloudWatch', {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: token,
  uid: 'my-app-cloudwatch',
  name: 'My App CloudWatch',
  type: 'cloudwatch',
  jsonDataJson: JSON.stringify({
    defaultRegion: 'eu-central-1',
    authType: 'assumeRole',
    assumeRoleArn: cwRole.roleArn,
  }),
});
```

## SNS alert integration

`GrafanaAlertSnsIntegration` creates an SNS topic, grants the Grafana workspace role `sns:Publish`, and wires up a Grafana contact point — all in one construct:

```typescript
const alertSns = new GrafanaAlertSnsIntegration(this, 'AlertSns', {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: token,
  uid: 'my-alert-sns',
  name: 'Prod Alerts',
  grafanaWorkspaceRoleArn: 'arn:aws:iam::111111111111:role/grafana-workspace-role',
});

alertSns.topic.addSubscription(
  new subscriptions.EmailSubscription('oncall@example.com'),
);
```

## Grafana API versioning

The library uses a centralized API version registry. All Grafana API paths, request shapes, and response parsers are defined per version in a single file (`lambda/grafana-provider/api-version.ts`).

Set `grafanaApiVersion` on any construct to target a specific Grafana version:

```typescript
new GrafanaFolder(this, 'Folder', {
  grafanaApiVersion: 'v11',
  // ...
});
```

To add support for a new Grafana version, create a new profile in the registry that inherits from the previous version and overrides only what changed. No handler code needs to change.

## Architecture

A single Lambda function per stack handles all Grafana resource types. The Lambda:

- Retrieves the API token from Secrets Manager (cached per invocation, cleared between invocations to support rotation)
- Downloads large payloads (dashboard JSON, contact point settings) from S3 assets
- Calls the Grafana HTTP API with retry logic (exponential backoff for 5xx/network errors, fail-fast on 4xx)
- Returns CloudFormation-compatible responses

## Development

```bash
npm install
npm run build    # TypeScript compilation
npm test         # Jest tests (134 tests, 80% coverage threshold)
npm run lint     # ESLint
```

## Security

- API tokens are resolved at deploy time from Secrets Manager and never stored in CloudFormation state
- Large and sensitive payloads are uploaded as S3 assets, not passed inline
- Grafana endpoint and UID inputs are validated at synth time and runtime to prevent SSRF and path traversal
- Authorization headers are never logged; error response bodies are truncated
- Lambda IAM permissions follow least-privilege (S3 read for assets, Secrets Manager read for tokens)

## License

Apache-2.0

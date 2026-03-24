# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) v2 (`npm install -g aws-cdk`)
- A running Grafana workspace (AWS Managed Grafana or self-hosted) with an API token stored in AWS Secrets Manager
- AWS CDK bootstrapped in the target account (`cdk bootstrap`)

## Installation

```bash
npm install cdk-grafana-resources
```

`aws-cdk-lib` and `constructs` are peer dependencies — install them if you haven't already:

```bash
npm install aws-cdk-lib constructs
```

## Quick Start

This example creates a folder and a dashboard in a Grafana workspace.

```typescript
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as fs from 'fs';
import { GrafanaFolder, GrafanaDashboard } from 'cdk-grafana-resources';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'MyGrafanaStack');

// Reference the Grafana API token stored in Secrets Manager
// (can be same-account or cross-account)
const tokenSecret = secretsmanager.Secret.fromSecretCompleteArn(
  stack, 'GrafanaToken',
  'arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/prod/service-account-token-AbCdEf',
);

const GRAFANA_ENDPOINT = 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com';

// Create a folder
const folder = new GrafanaFolder(stack, 'ProdFolder', {
  grafanaEndpoint: GRAFANA_ENDPOINT,
  apiTokenSecret: tokenSecret,
  uid: 'my-app-prod',
  title: 'My App — Prod',
});

// Create a dashboard in that folder
new GrafanaDashboard(stack, 'OverviewDashboard', {
  grafanaEndpoint: GRAFANA_ENDPOINT,
  apiTokenSecret: tokenSecret,
  uid: 'my-app-overview',
  folderUid: folder, // automatic CloudFormation dependency
  dashboardJson: fs.readFileSync('grafana/dashboards/overview.json', 'utf-8'),
});
```

Deploy:

```bash
cdk deploy
```

The folder and dashboard are now managed by CloudFormation. Updating the JSON and redeploying updates the dashboard. Destroying the stack deletes the resources from Grafana.

## Cross-Account Setup

The typical deployment pattern has the Grafana workspace in a central shared account and project stacks in separate project accounts:

```
Project Account (111111111111)         Shared Account (999999999999)
┌──────────────────────┐              ┌──────────────────────────┐
│ Project CDK Stack     │              │ Grafana Workspace        │
│                       │              │                          │
│ Custom Resource       │──HTTP API──▶│ Dashboards, Alerts, ...  │
│ Lambda                │              │                          │
│       │               │              │                          │
│       ▼               │              │                          │
│ Reads token from ─────│─────────────▶│ Secrets Manager Secret  │
│ Secrets Manager       │              │ (cross-account policy)   │
└──────────────────────┘              └──────────────────────────┘
```

For this to work, the Secrets Manager secret in the shared account needs a resource policy granting `secretsmanager:GetSecretValue` to the project account's Lambda execution role. See the [Authentication guide](authentication.md) for details.

## What's Next

- [Constructs Reference](constructs.md) — full API for all constructs
- [Authentication](authentication.md) — cross-account setup and token rotation
- [CloudWatch Integration](cloudwatch-integration.md) — project-owned CloudWatch datasources
- [Patterns](patterns.md) — common deployment patterns and project structure

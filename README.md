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

## Documentation

| Topic | Description |
| --- | --- |
| [Constructs](doc/user-doc/constructs.md) | Full construct reference and shared props |
| [Authentication](doc/user-doc/authentication.md) | API token setup and cross-account KMS requirements |
| [CloudWatch datasource](doc/user-doc/cloudwatch-datasource.md) | IAM role for CloudWatch metrics and logs |
| [SNS alert integration](doc/user-doc/sns-alert-integration.md) | One-construct SNS + contact point wiring |
| [API versioning](doc/user-doc/api-versioning.md) | Targeting different Grafana API versions |
| [Architecture](doc/user-doc/architecture.md) | How the Lambda-backed custom resource works |
| [Security](doc/user-doc/security.md) | Security model and design decisions |

## Development

```bash
npm install
npm run build    # TypeScript compilation
npm test         # Jest tests (134 tests, 80% coverage threshold)
npm run lint     # ESLint
```

## License

Apache-2.0

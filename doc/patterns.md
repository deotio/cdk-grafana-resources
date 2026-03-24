# Patterns

Common deployment patterns and project structure recommendations.

## Recommended Project Structure

```
my-app/
├── cdk/
│   ├── bin/
│   │   └── app.ts
│   ├── lib/
│   │   ├── app-stack.ts           # Application infrastructure
│   │   └── observability-stack.ts # Grafana resources
│   └── grafana/
│       ├── dashboards/
│       │   ├── overview.json
│       │   └── api-latency.json
│       └── alerts/
│           └── high-cpu.json
├── src/                           # Application source
└── package.json
```

Keep dashboard JSON files alongside the CDK code that deploys them. Export dashboards from Grafana's UI ("Share" > "Export" > "Save to file") and commit them to the repo.

## Sharing Configuration Across Constructs

Avoid repeating `grafanaEndpoint` and `apiTokenSecret` on every construct. Define them once:

```typescript
const grafanaConfig = {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: secretsmanager.Secret.fromSecretCompleteArn(
    stack, 'GrafanaToken',
    'arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/token-AbCdEf',
  ),
};

const folder = new GrafanaFolder(stack, 'Folder', {
  ...grafanaConfig,
  uid: 'my-app-prod',
  title: 'My App — Prod',
});

new GrafanaDashboard(stack, 'Dashboard', {
  ...grafanaConfig,
  uid: 'my-app-overview',
  folderUid: folder,
  dashboardJson: fs.readFileSync('grafana/dashboards/overview.json', 'utf-8'),
});
```

## Loading All Dashboards from a Directory

```typescript
import * as fs from 'fs';
import * as path from 'path';

const dashboardDir = path.join(__dirname, '..', 'grafana', 'dashboards');
const files = fs.readdirSync(dashboardDir).filter(f => f.endsWith('.json'));

for (const file of files) {
  const name = path.basename(file, '.json');
  new GrafanaDashboard(stack, `Dashboard-${name}`, {
    ...grafanaConfig,
    uid: `my-app-${name}`,
    folderUid: folder,
    dashboardJson: fs.readFileSync(path.join(dashboardDir, file), 'utf-8'),
  });
}
```

## Separate Observability Stack

For larger projects, separate infrastructure and observability into different stacks. This lets you update dashboards without touching application infrastructure:

```typescript
// bin/app.ts
const appStack = new AppStack(app, 'MyApp', { env });
const obsStack = new ObservabilityStack(app, 'MyApp-Observability', {
  env,
  grafanaConfig,
});
```

The observability stack deploys independently, so dashboard changes don't risk application downtime.

## Parameterizing the Grafana Endpoint

Use CDK context to pass the Grafana endpoint and token ARN, making the stack reusable across environments:

```typescript
// bin/app.ts
const grafanaEndpoint = app.node.tryGetContext('grafanaEndpoint');
const tokenSecretArn = app.node.tryGetContext('grafanaTokenSecretArn');

if (!grafanaEndpoint || !tokenSecretArn) {
  throw new Error('Missing context: grafanaEndpoint and grafanaTokenSecretArn are required');
}
```

Deploy with:

```bash
cdk deploy \
  -c grafanaEndpoint=g-abc123.grafana-workspace.eu-central-1.amazonaws.com \
  -c grafanaTokenSecretArn=arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/token-AbCdEf
```

Or set them in `cdk.json`:

```json
{
  "context": {
    "grafanaEndpoint": "g-abc123.grafana-workspace.eu-central-1.amazonaws.com",
    "grafanaTokenSecretArn": "arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/token-AbCdEf"
  }
}
```

## Alert Rules with Datasource References

Alert rules typically reference a datasource by UID. When both are managed by the same stack, use the construct's `uid` property:

```typescript
const cloudwatch = new GrafanaDatasource(stack, 'CloudWatch', {
  ...grafanaConfig,
  uid: 'my-app-cw',
  name: 'My App CloudWatch',
  type: 'cloudwatch',
  jsonDataJson: JSON.stringify({
    defaultRegion: 'eu-central-1',
    authType: 'assumeRole',
    assumeRoleArn: cwRole.roleArn,
  }),
});

// Reference the datasource UID in the alert rule JSON
const alertRule = {
  title: 'High CPU',
  condition: 'C',
  data: [
    {
      refId: 'A',
      datasourceUid: cloudwatch.uid, // 'my-app-cw'
      model: {
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        // ...
      },
    },
  ],
  // ...
};

new GrafanaAlertRule(stack, 'HighCPU', {
  ...grafanaConfig,
  uid: 'my-app-high-cpu',
  folderUid: folder,
  ruleGroup: 'my-app-alerts',
  ruleJson: JSON.stringify(alertRule),
});
```

## Central vs. Project Ownership

| Resource | Central stack | Project stack |
|---|---|---|
| Grafana workspace | Yes | — |
| Workspace service role | Yes | — |
| API token + Secrets Manager secret | Yes | — |
| Shared folders (dev, prod) | Optional | Optional |
| Notification policy | Yes | — |
| Shared contact points (e.g., OpsGenie) | Yes | — |
| CloudWatch IAM role | — | Yes |
| Project-specific datasources | — | Yes |
| Project-specific folders | — | Yes |
| Project dashboards | — | Yes |
| Project alert rules | — | Yes |
| Project contact points | — | Yes |

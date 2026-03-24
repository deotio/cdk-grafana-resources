# Constructs Reference

All Grafana resource constructs share a common base interface and use a singleton Lambda provider per stack.

## Common Props

Every Grafana resource construct extends `GrafanaResourceProps`:

| Prop | Type | Required | Description |
|---|---|---|---|
| `grafanaEndpoint` | `string` | Yes | Grafana hostname (no protocol or path). Example: `g-abc123.grafana-workspace.eu-central-1.amazonaws.com` |
| `apiTokenSecret` | `ISecret` | Yes | Secrets Manager secret containing the Grafana API token (plain string, not JSON) |
| `providerProps` | `GrafanaProviderProps` | No | Provider Lambda config (VPC, log retention, concurrency). Only used by the first construct in the stack. |

### Input Validation

All constructs validate inputs at synth time:

- **`grafanaEndpoint`** — must match `/^[a-zA-Z0-9.-]+(:[0-9]+)?$/`. Rejects paths, query strings, and userinfo to prevent SSRF.
- **`uid`** — must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`. Prevents URL path traversal.

The Lambda re-validates the endpoint at deploy time as a defense-in-depth measure.

### Provider Configuration

The singleton provider Lambda is created by the first construct in the stack. Configure it via `providerProps`:

```typescript
new GrafanaFolder(stack, 'Folder', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-folder',
  title: 'My Folder',
  providerProps: {
    logRetention: logs.RetentionDays.TWO_WEEKS,
    reservedConcurrentExecutions: 5,
    // For Grafana behind a VPC:
    vpc: myVpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  },
});
```

Subsequent constructs in the same stack reuse the existing provider — their `providerProps` are ignored.

---

## GrafanaFolder

Creates or updates a Grafana folder.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `uid` | `string` | Yes | Stable unique identifier. Cannot be changed after creation. |
| `title` | `string` | Yes | Display title in Grafana. |

### Outputs

| Property | Type | Description |
|---|---|---|
| `uid` | `string` | Same as input (for cross-referencing) |
| `folderId` | `string` | Grafana-assigned numeric folder ID |
| `apiTokenSecret` | `ISecret` | Pass-through for reuse by child constructs |

### Example

```typescript
const folder = new GrafanaFolder(stack, 'ProdFolder', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-app-prod',
  title: 'My App — Prod',
});
```

---

## GrafanaDashboard

Creates or updates a dashboard within a folder.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `uid` | `string` | Yes | Stable unique identifier. Overrides any `uid` in the JSON. |
| `folderUid` | `GrafanaFolder \| string` | Yes | Target folder. Pass a `GrafanaFolder` construct for automatic dependency ordering, or a plain UID string. |
| `dashboardJson` | `string` | Yes | Dashboard model as a JSON string (from Grafana's export format). Uploaded as an S3 asset — no size limit. |
| `message` | `string` | No | Commit message in Grafana's version history. Default: `'Deployed by cdk-grafana-resources'` |

### Outputs

| Property | Type | Description |
|---|---|---|
| `uid` | `string` | Dashboard UID |
| `dashboardId` | `string` | Grafana-assigned numeric ID |
| `url` | `string` | Dashboard URL path (e.g., `/d/abc123/my-dashboard`) |
| `version` | `string` | Version number (increments on each update) |

### Example

```typescript
import * as fs from 'fs';

new GrafanaDashboard(stack, 'Overview', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-app-overview',
  folderUid: folder, // GrafanaFolder construct — auto dependency
  dashboardJson: fs.readFileSync('grafana/dashboards/overview.json', 'utf-8'),
  message: 'Deployed from CI',
});
```

### Dashboard JSON Handling

The construct processes the JSON before sending it to Grafana:
1. Sets `dashboard.uid` to the construct's `uid` prop
2. Sets `dashboard.id` to `null` (required for the Grafana API)
3. Uses `overwrite: true` for idempotent create/update

You can export a dashboard from the Grafana UI (JSON model), save it to your repo, and use it directly — the construct handles the rest.

---

## GrafanaAlertRule

Creates or updates a Grafana-managed alert rule.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `uid` | `string` | Yes | Stable unique identifier. |
| `folderUid` | `GrafanaFolder \| string` | Yes | Folder containing this alert rule. |
| `ruleGroup` | `string` | Yes | Rule group name. Rules in the same group are evaluated together. |
| `ruleJson` | `string` | Yes | Alert rule definition as JSON (from Grafana's provisioning API export). Uploaded as S3 asset. |

### Outputs

| Property | Type | Description |
|---|---|---|
| `uid` | `string` | Alert rule UID |

### Example

```typescript
new GrafanaAlertRule(stack, 'HighCPU', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-app-high-cpu',
  folderUid: folder,
  ruleGroup: 'my-app-alerts',
  ruleJson: fs.readFileSync('grafana/alerts/high-cpu.json', 'utf-8'),
});
```

### Notes

- Uses the Grafana provisioning API with `X-Disable-Provenance: true`, so rules can still be edited in the UI if needed.
- On create, if the UID already exists (e.g., during CloudFormation resource replacement), the handler falls back to an update.

---

## GrafanaContactPoint

Creates or updates a contact point for alert notifications.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `uid` | `string` | Yes | Stable unique identifier. |
| `name` | `string` | Yes | Display name of the contact point. |
| `type` | `string` | Yes | Contact point type: `'email'`, `'slack'`, `'opsgenie'`, `'pagerduty'`, `'webhook'`, etc. |
| `settingsJson` | `string` | Yes | Type-specific settings as JSON. Uploaded as S3 asset (never in CloudFormation state). |

### Outputs

| Property | Type | Description |
|---|---|---|
| `uid` | `string` | Contact point UID |

### Example

```typescript
new GrafanaContactPoint(stack, 'OpsGenie', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-app-opsgenie',
  name: 'My App OpsGenie',
  type: 'opsgenie',
  settingsJson: JSON.stringify({
    apiUrl: 'https://api.atlassian.com/jsm/ops/integration/v2/alerts',
    apiKey: opsGenieApiKey,
  }),
});
```

### Security

Contact point settings often contain secrets (webhook URLs, API keys). The `settingsJson` is uploaded as a CDK S3 asset and never appears in CloudFormation state. For additional protection, use Grafana's `secureSettings` field within the JSON — Grafana stores those values encrypted.

---

## GrafanaDatasource

Creates or updates a datasource.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `uid` | `string` | Yes | Stable unique identifier. |
| `name` | `string` | Yes | Display name of the datasource. |
| `type` | `string` | Yes | Datasource type: `'cloudwatch'`, `'prometheus'`, `'elasticsearch'`, etc. |
| `access` | `'proxy' \| 'direct'` | No | Access mode. Default: `'proxy'` |
| `jsonDataJson` | `string` | No | Type-specific config as JSON. Passed inline (non-sensitive). |
| `secureJsonData` | `ISecret \| string` | No | Sensitive config. `ISecret`: resolved at deploy time from Secrets Manager. `string`: uploaded as S3 asset. |
| `isDefault` | `boolean` | No | Whether this is the default datasource of its type. Default: `false` |

### Outputs

| Property | Type | Description |
|---|---|---|
| `uid` | `string` | Datasource UID |
| `datasourceId` | `string` | Grafana-assigned numeric ID |

### Example — CloudWatch with cross-account role

```typescript
import { GrafanaCloudWatchRole, GrafanaDatasource } from 'cdk-grafana-resources';

const cwRole = new GrafanaCloudWatchRole(stack, 'GrafanaCW', {
  grafanaServiceRoleArn: 'arn:aws:iam::999999999999:role/grafana-service-role',
});

new GrafanaDatasource(stack, 'CloudWatch', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
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

### Example — Prometheus with password in Secrets Manager

```typescript
const promPassword = secretsmanager.Secret.fromSecretNameV2(
  stack, 'PromPassword', 'my-app/prometheus/password',
);

new GrafanaDatasource(stack, 'Prometheus', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-app-prometheus',
  name: 'My App Prometheus',
  type: 'prometheus',
  jsonDataJson: JSON.stringify({
    httpMethod: 'POST',
    url: 'https://prometheus.internal:9090',
  }),
  secureJsonData: promPassword, // resolved at deploy time, never in CloudFormation
});
```

---

## GrafanaNotificationPolicy

Manages the notification policy tree (routing of alerts to contact points).

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `policyJson` | `string` | Yes | Full notification policy tree as JSON. Replaces the entire tree. |

### Example

```typescript
new GrafanaNotificationPolicy(stack, 'Policy', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  policyJson: JSON.stringify({
    receiver: 'default-email',
    group_by: ['grafana_folder', 'alertname'],
    routes: [
      {
        receiver: 'my-app-opsgenie',
        matchers: ['app=my-app'],
        group_wait: '10s',
      },
    ],
  }),
});
```

### Important

- **Singleton per workspace** — Grafana has exactly one policy tree. Only one `GrafanaNotificationPolicy` should target a given workspace. Multiple stacks targeting the same workspace will overwrite each other.
- **Use from the central stack only** — project stacks should create contact points and alert rules, not notification policies.
- **Delete resets to default** — destroying the stack resets the policy tree to Grafana's default (single root policy with the default email receiver).

---

## GrafanaCloudWatchRole

Creates an IAM role in the project account for Grafana to assume when querying CloudWatch metrics and logs. This is **not** a Grafana API construct — it's an IAM construct that pairs with `GrafanaDatasource`.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `grafanaServiceRoleArn` | `string` | Yes | ARN of the Grafana workspace's service role in the central account. |
| `roleName` | `string` | No | IAM role name. Default: CDK-generated unique name. |
| `additionalActions` | `string[]` | No | Extra IAM actions beyond the default CloudWatch read-only set. |

### Outputs

| Property | Type | Description |
|---|---|---|
| `role` | `iam.Role` | The IAM role construct |
| `roleArn` | `string` | Role ARN — pass to `GrafanaDatasource.jsonDataJson` as `assumeRoleArn` |

### Default Actions

The role grants these actions by default (all require `Resource: '*'` per AWS docs):

- `cloudwatch:DescribeAlarmsForMetric`, `DescribeAlarmHistory`, `DescribeAlarms`, `ListMetrics`, `GetMetricData`, `GetMetricStatistics`, `GetInsightRuleReport`
- `logs:DescribeLogGroups`, `GetLogGroupFields`, `StartQuery`, `StopQuery`, `GetQueryResults`, `GetLogEvents`
- `ec2:DescribeTags`, `DescribeInstances`, `DescribeRegions`
- `tag:GetResources`

### Example — with X-Ray traces

```typescript
const cwRole = new GrafanaCloudWatchRole(stack, 'GrafanaCW', {
  grafanaServiceRoleArn: grafanaServiceRoleArn,
  roleName: 'grafana-cloudwatch-read',
  additionalActions: [
    'xray:GetTraceSummaries',
    'xray:BatchGetTraces',
    'xray:GetServiceGraph',
  ],
});
```

See the [CloudWatch Integration guide](cloudwatch-integration.md) for the full cross-account setup pattern.

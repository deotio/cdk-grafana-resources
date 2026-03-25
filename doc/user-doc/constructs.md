# Constructs

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

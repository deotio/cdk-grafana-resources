# SNS alert integration

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

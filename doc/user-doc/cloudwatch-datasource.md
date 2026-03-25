# CloudWatch datasource

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

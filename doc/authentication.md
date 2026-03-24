# Authentication

## How It Works

All constructs authenticate to the Grafana HTTP API using a service account token stored in AWS Secrets Manager. The token is never present in CloudFormation templates, stack events, or the CDK cloud assembly — only the secret ARN is stored. The Lambda resolves the token at deploy time.

```
cdk deploy
    │
    ▼
CloudFormation invokes Custom Resource Lambda
    │
    ▼
Lambda reads token from Secrets Manager (secret ARN from resource properties)
    │
    ▼
Lambda calls Grafana HTTP API with Authorization: Bearer <token>
```

## Same-Account Setup

If the Grafana workspace and project stack are in the same AWS account:

```typescript
const secret = secretsmanager.Secret.fromSecretNameV2(
  stack, 'GrafanaToken', 'grafana/prod/service-account-token',
);

new GrafanaFolder(stack, 'Folder', {
  grafanaEndpoint: ENDPOINT,
  apiTokenSecret: secret,
  uid: 'my-folder',
  title: 'My Folder',
});
```

The construct automatically grants `secretsmanager:GetSecretValue` to the Lambda. No additional configuration needed.

## Cross-Account Setup

When the Grafana workspace is in a central shared account and project stacks deploy from separate accounts, two things are needed:

### 1. Secret resource policy (central account)

The Secrets Manager secret in the central account must allow the project account's Lambda to read it. There are two approaches:

**Per-role access (most secure):**

After deploying the project stack for the first time, note the Lambda execution role ARN from the stack outputs, then add it to the secret's resource policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:role/MyStack-GrafanaProviderHandlerRole-XXXXX"
      },
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "*"
    }
  ]
}
```

**Pattern-based access (convenient for many accounts):**

Use a condition to match all Lambda roles created by this library:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "*" },
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "*",
      "Condition": {
        "ArnLike": {
          "aws:PrincipalArn": "arn:aws:iam::*:role/*GrafanaProvider*"
        }
      }
    }
  ]
}
```

### 2. Secret reference (project stack)

In the project stack, reference the secret by its full ARN:

```typescript
const secret = secretsmanager.Secret.fromSecretCompleteArn(
  stack, 'GrafanaToken',
  'arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/prod/service-account-token-AbCdEf',
);
```

Use `fromSecretCompleteArn` (not `fromSecretNameV2`) for cross-account secrets — the full ARN is required for the IAM grant to scope correctly.

### KMS Considerations

If the secret is encrypted with a **customer-managed KMS key**, the Lambda also needs `kms:Decrypt` on that key. The library cannot grant this automatically for cross-account keys — the central team must add the project account (or Lambda role) to the KMS key policy.

**Recommendation:** Use the default AWS-managed key (`aws/secretsmanager`) for the Grafana token secret. It's simpler and sufficient for this use case.

## Token Rotation

Grafana service account tokens have a configurable TTL (commonly 30 days). When the central stack rotates the token:

1. The central CI/CD pipeline recreates the token and updates the Secrets Manager secret
2. On the next project stack deployment, the Lambda reads the new token

No action is needed from project teams. The Lambda clears its token cache at the start of each CloudFormation invocation, ensuring rotated tokens are picked up immediately.

### Deploy during rotation

If a project deploys during the brief window where the old token is invalidated but the new one isn't yet in Secrets Manager, the Lambda gets a 401 from Grafana. CloudFormation will report the Custom Resource as failed and roll back. Redeploying after rotation completes resolves this.

To minimize this window, the central pipeline should update the Secrets Manager secret **before** deleting the old token.

## Lambda IAM Permissions

The library grants minimal permissions automatically:

| Permission | Resource | Purpose |
|---|---|---|
| `secretsmanager:GetSecretValue` | Grafana API token secret | Authenticate to Grafana |
| `secretsmanager:DescribeSecret` | Grafana API token secret | Required by `ISecret.grantRead()` |
| `secretsmanager:GetSecretValue` | Datasource `secureJsonData` secret (if using `ISecret`) | Resolve datasource credentials |
| `s3:GetObject` | CDK asset bucket | Read dashboard JSON, alert rules, contact point settings |
| CloudWatch Logs | Auto-created log group | Lambda execution logs |

No other AWS permissions are needed. All Grafana operations are HTTP API calls, not AWS API calls.

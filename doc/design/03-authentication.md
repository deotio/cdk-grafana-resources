# 03 — Authentication

## Token Flow

```
Deploy time (cdk deploy)
    │
    ▼
CloudFormation invokes Custom Resource Lambda
    │
    ▼
Lambda reads Grafana API token from Secrets Manager
    │  (cross-account if workspace is in a different account)
    │
    ▼
Lambda calls Grafana HTTP API with Bearer token
```

The API token is **never** present in:
- CloudFormation templates
- CloudFormation resource properties (only the Secret ARN is stored)
- CloudFormation events or outputs
- CDK cloud assembly (`cdk.out/`)

## Supported Authentication Methods

### 1. Secrets Manager (primary, recommended)

The construct accepts an `ISecret` reference. The Lambda resolves the secret value at runtime.

```typescript
// Same account
const secret = secretsmanager.Secret.fromSecretNameV2(this, 'Token', 'grafana/prod/token');

// Cross-account (requires resource policy on the secret)
const secret = secretsmanager.Secret.fromSecretCompleteArn(
  this, 'Token',
  'arn:aws:secretsmanager:eu-central-1:981025486549:secret:grafana/prod/service-account-token-AbCdEf',
);
```

### 2. SSM Parameter Store (deferred to post-v1)

Some teams store tokens in SSM Parameter Store (SecureString) instead of Secrets Manager. If demand arises, a future version could accept `IParameter` as an alternative:

```typescript
// Potential future API (NOT in v1):
export interface GrafanaResourceProps {
  // One of these must be provided:
  readonly apiTokenSecret?: secretsmanager.ISecret;
  readonly apiTokenParameter?: ssm.IStringParameter;
}
```

**Decision:** v1 uses Secrets Manager only. `apiTokenSecret` is required (not optional) in the current `GrafanaResourceProps`. This keeps the API simple and the Lambda IAM policy narrow.

## Cross-Account Access

The typical deployment pattern for `cdk-grafana-resources`:

```
Project Account (111111111111)         Shared Account (999999999999)
┌──────────────────────┐              ┌──────────────────────────┐
│ Project CDK Stack     │              │ Grafana Infra Stack      │
│                       │              │                          │
│ Custom Resource Lambda│──read──────▶│ Secrets Manager Secret   │
│ (needs secret read)   │              │ (resource policy grants  │
│                       │              │  cross-account read)     │
│                       │──HTTP API──▶│ Grafana Workspace        │
└──────────────────────┘              └──────────────────────────┘
```

### Requirements on the secret (managed by the central Grafana repo)

The secret must have a resource policy granting `secretsmanager:GetSecretValue` to the project account's Lambda execution role. **Do not grant access to the account root** — this would allow any principal in the account to read the Grafana token.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:role/ProjectStack-GrafanaProviderHandlerRole-XXXXX"
      },
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "*"
    }
  ]
}
```

To obtain the role ARN, the project stack should output it as a `CfnOutput`:

```typescript
const provider = GrafanaProvider.getOrCreate(this);
new cdk.CfnOutput(this, 'GrafanaProviderRoleArn', {
  value: provider.handler.role!.roleArn,
  description: 'Role ARN for Grafana token secret resource policy',
});
```

The central Grafana team then adds this role ARN to the secret's resource policy. For organizations with many project accounts, a pattern-based condition can be used instead:

```json
{
  "Condition": {
    "ArnLike": {
      "aws:PrincipalArn": "arn:aws:iam::*:role/*GrafanaProvider*"
    }
  }
}
```

This is already planned in the `dot-grafana` CDK stack (see Phase 3, §3.7).

### Requirements on the Lambda (managed by `cdk-grafana-resources`)

The Lambda's execution role needs:

```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
  "Resource": "arn:aws:secretsmanager:eu-central-1:999999999999:secret:grafana/prod/*"
}
```

This is granted automatically by `secret.grantRead(handler)` when using `ISecret.fromSecretCompleteArn()`.

### KMS considerations

If the secret is encrypted with a customer-managed KMS key (not the default `aws/secretsmanager` key), the Lambda also needs `kms:Decrypt` on that key. The construct documentation should note this, but the construct itself cannot automatically grant cross-account KMS access — the central team must add the project account to the KMS key policy.

**Recommendation:** Use the default AWS-managed key for the Grafana token secret. It's simpler and sufficient for this use case.

## Token Rotation

Grafana service account tokens have a configurable TTL (the `dot-grafana` plan uses 30 days). When the token rotates:

1. The central Grafana stack's CI/CD pipeline recreates the token and updates Secrets Manager
2. The next time any project stack deploys (or any Custom Resource is invoked), the Lambda reads the new token

No action is needed from project teams. The token is resolved fresh on each Lambda invocation (with per-invocation caching for efficiency).

### Edge case: deploy during rotation

If a project deploys while the token is being rotated (brief window where the old token is invalidated but the new one isn't in Secrets Manager yet), the Lambda will get a 401 from Grafana. This will cause the Custom Resource to fail, and CloudFormation will retry or roll back.

Mitigation: The central Grafana CI/CD pipeline should update the Secrets Manager secret **before** deleting the old token. The `dot-grafana` plan uses `AwsCustomResource` with `onCreate` only (no `onUpdate`), so the token is replaced atomically when the Custom Resource is replaced.

## Lambda IAM Policy

The Provider construct grants minimal permissions:

```typescript
// Automatically granted by the Provider for each unique secret:
secret.grantRead(provider.onEventHandler);
```

The Lambda needs **no AWS permissions beyond Secrets Manager read and S3 asset read**. All Grafana operations are HTTP API calls, not AWS API calls.

Summary of Lambda IAM:

| Permission | Resource | Granted by |
|---|---|---|
| `secretsmanager:GetSecretValue` | Grafana API token secret ARN | `provider.grantSecretRead()` |
| `secretsmanager:DescribeSecret` | Grafana API token secret ARN | `provider.grantSecretRead()` |
| `secretsmanager:GetSecretValue` | Datasource `secureJsonData` secret ARN (if `ISecret` used) | `provider.grantSecretRead()` |
| `s3:GetObject` | CDK asset bucket (dashboard JSON, settings JSON) | `asset.grantRead()` |
| Basic Lambda execution | CloudWatch Logs | CDK Lambda construct (automatic) |

No other AWS permissions are needed. All Grafana operations are HTTP API calls, not AWS API calls.

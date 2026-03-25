# Authentication

The Grafana API token must be stored as a plain string in an AWS Secrets Manager secret. The library resolves the token at deploy time — it never appears in CloudFormation state or logs.

## Cross-account setup

For cross-account setups (Grafana workspace in a shared account, CDK stack in a project account):

1. **Use a customer managed KMS key** — Secrets Manager secrets encrypted with the default AWS managed key (`aws/secretsmanager`) cannot be accessed cross-account. Create a customer managed KMS key and encrypt the secret with it.
2. **Add a KMS key policy** allowing the consuming account (or the Lambda execution role) to perform `kms:Decrypt`.
3. **Add a resource policy on the secret** allowing the consuming account to call `secretsmanager:GetSecretValue`.

```typescript
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// In the shared account stack that owns the secret
const key = new kms.Key(this, 'GrafanaTokenKey', {
  description: 'Encrypts the Grafana API token for cross-account access',
});

key.addToResourcePolicy(new iam.PolicyStatement({
  actions: ['kms:Decrypt'],
  principals: [new iam.AccountPrincipal('PROJECT_ACCOUNT_ID')],
  resources: ['*'],
}));

const token = new secretsmanager.Secret(this, 'GrafanaToken', {
  encryptionKey: key,
});

token.addToResourcePolicy(new iam.PolicyStatement({
  actions: ['secretsmanager:GetSecretValue'],
  principals: [new iam.AccountPrincipal('PROJECT_ACCOUNT_ID')],
  resources: ['*'],
}));
```

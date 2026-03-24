# 04 — Testing Strategy

## Test Layers

| Layer | What it tests | Tools | Runs in CI |
|---|---|---|---|
| **Unit tests** | Synthesized CloudFormation output (correct Custom Resource properties, IAM grants, provider wiring) | Jest, `aws-cdk-lib/assertions` | Yes |
| **Lambda unit tests** | Handler logic (request building, response parsing, error handling) | Jest, mocked `fetch` | Yes |
| **Integration tests** | End-to-end: deploy stack, verify resources exist in Grafana, destroy stack | Jest, real Grafana instance | Optional / manual |
| **cdk-nag** | Security & compliance of synthesized templates | cdk-nag `AwsSolutionsChecks` | Yes |

## Unit Tests — Constructs

Verify that constructs synthesize correct CloudFormation templates:

```typescript
import { Template, Match } from 'aws-cdk-lib/assertions';

describe('GrafanaDashboard', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new GrafanaDashboard(stack, 'Dashboard', {
      grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
      apiTokenSecret: secretsmanager.Secret.fromSecretCompleteArn(
        stack, 'Secret', 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:token-AbCdEf',
      ),
      uid: 'test-dash',
      folderUid: 'test-folder', // string UID — no auto-dependency
      dashboardJson: '{"title":"Test"}',
    });

    template = Template.fromStack(stack);
  });

  test('creates a Custom Resource with correct properties', () => {
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      GrafanaResourceType: 'Dashboard',
      GrafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
      Uid: 'test-dash',
      FolderUid: 'test-folder',
      DashboardAssetBucket: Match.anyValue(),
      DashboardAssetKey: Match.anyValue(),
    });
  });

  test('secret ARN is passed, not the secret value', () => {
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SecretArn: Match.stringLikeRegexp('^arn:aws:secretsmanager:'),
    });
  });

  test('grants the Lambda read access to the secret', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            Resource: Match.stringLikeRegexp('token-AbCdEf'),
          }),
        ]),
      },
    });
  });

  test('passing GrafanaFolder creates automatic dependency', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'DepTest');
    const secret = secretsmanager.Secret.fromSecretCompleteArn(
      stack, 'S', 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:t-XyZ',
    );

    const folder = new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
      apiTokenSecret: secret,
      uid: 'test-folder',
      title: 'Test',
    });

    const dashboard = new GrafanaDashboard(stack, 'Dashboard', {
      grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
      apiTokenSecret: secret,
      uid: 'test-dash',
      folderUid: folder, // pass construct
      dashboardJson: '{"title":"Test"}',
    });

    const t = Template.fromStack(stack);
    // Dashboard Custom Resource should DependsOn the folder Custom Resource
    t.hasResource('AWS::CloudFormation::CustomResource', {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp('Folder')]),
    });
  });

  test('uses a singleton provider (one handler Lambda per stack)', () => {
    // Add a second construct to the same stack
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TwoResources');
    const secret = secretsmanager.Secret.fromSecretCompleteArn(
      stack, 'S', 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:t-XyZ',
    );

    new GrafanaDashboard(stack, 'D1', { ...baseProps, uid: 'd1' });
    new GrafanaDashboard(stack, 'D2', { ...baseProps, uid: 'd2' });

    const t = Template.fromStack(stack);
    // The stack will have multiple Lambda functions (handler, Provider
    // framework, log retention custom resource), but only one should
    // match the handler description.
    t.resourceCountIs('AWS::Lambda::Function',
      Match.objectLike({
        Description: Match.stringLikeRegexp('cdk-grafana-resources'),
      }),
    );
    // Alternative: count Custom::AWS resources — there should be exactly 2
    // (one per dashboard), both pointing to the same ServiceToken.
  });
});
```

## Unit Tests — Lambda Handler

Test the handler logic in isolation with mocked HTTP calls:

```typescript
import { onEvent } from '../lambda/grafana-provider/index';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock Secrets Manager
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'test-token' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

// Mock S3 (for dashboard JSON asset download)
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Body: { transformToString: () => Promise.resolve('{"title":"Test","panels":[]}') },
    }),
  })),
  GetObjectCommand: jest.fn(),
}));

describe('Dashboard handler', () => {
  const baseEvent = {
    RequestType: 'Create',
    ResourceProperties: {
      ServiceToken: 'arn:aws:lambda:...',
      GrafanaResourceType: 'Dashboard',
      GrafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
      SecretArn: 'arn:aws:secretsmanager:eu-central-1:123:secret:token',
      Uid: 'test-dash',
      FolderUid: 'prod',
      DashboardAssetBucket: 'cdk-asset-bucket',
      DashboardAssetKey: 'assets/abc123.json',
    },
  };

  test('Create sends POST with overwrite=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        id: 1, uid: 'test-dash', url: '/d/test-dash/test', version: 1,
      })),
    });

    const result = await onEvent(baseEvent as any);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://g-abc123.grafana-workspace.eu-central-1.amazonaws.com/api/dashboards/db',
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.overwrite).toBe(true);
    expect(body.dashboard.uid).toBe('test-dash');
    expect(body.dashboard.id).toBeNull();
    expect(result.PhysicalResourceId).toBe('test-dash');
  });

  test('Update sends POST with overwrite=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        id: 1, uid: 'test-dash', url: '/d/test-dash/test', version: 2,
      })),
    });

    const event = { ...baseEvent, RequestType: 'Update' };
    await onEvent(event as any);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.overwrite).toBe(true);
  });

  test('Delete sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    const event = { ...baseEvent, RequestType: 'Delete' };
    await onEvent(event as any);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/dashboards/uid/test-dash'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('Delete ignores 404 (already deleted)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 404,
      text: () => Promise.resolve('Dashboard not found'),
    });

    const event = { ...baseEvent, RequestType: 'Delete' };
    const result = await onEvent(event as any);

    expect(result.PhysicalResourceId).toBe('test-dash');
  });

  test('4xx error throws immediately without retry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400,
      text: () => Promise.resolve('Bad request'),
    });

    await expect(onEvent(baseEvent as any)).rejects.toThrow('400');
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retry
  });

  test('5xx error retries with backoff', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 502, text: () => Promise.resolve('Bad Gateway') })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 1, uid: 'test-dash', url: '/d/test-dash/test', version: 1 })),
      });

    const result = await onEvent(baseEvent as any);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.PhysicalResourceId).toBe('test-dash');
  });

  test('network error (fetch throws) retries with backoff', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 1, uid: 'test-dash', url: '/d/test-dash/test', version: 1 })),
      });

    const result = await onEvent(baseEvent as any);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.PhysicalResourceId).toBe('test-dash');
  });
});
```

## cdk-nag Validation

```typescript
import { AwsSolutionsChecks } from 'cdk-nag';
import { Annotations } from 'aws-cdk-lib/assertions';

test('no unsuppressed cdk-nag errors', () => {
  const app = new cdk.App();
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

  const stack = new cdk.Stack(app, 'NagTest');
  new GrafanaDashboard(stack, 'D', { ... });

  app.synth();

  const errors = Annotations.fromStack(stack)
    .findError('*', Match.stringLikeRegexp('AwsSolutions-.*'));
  expect(errors).toHaveLength(0);
});
```

## Integration Tests

Integration tests deploy a real stack against a Grafana instance and verify the resources exist. These are **not** run in CI by default — they require a live Grafana workspace.

```typescript
// test/integ/dashboard.integ.ts

describe('GrafanaDashboard integration', () => {
  const endpoint = process.env.GRAFANA_ENDPOINT!;
  const token = process.env.GRAFANA_TOKEN!;

  test('dashboard exists after deploy', async () => {
    const res = await fetch(`https://${endpoint}/api/dashboards/uid/integ-test-dash`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dashboard.title).toBe('Integration Test Dashboard');
  });
});
```

Integration tests can be run manually:

```bash
# Deploy the integration test stack
cd test/integ && npx cdk deploy --app 'npx ts-node integ-app.ts'

# Run assertions
GRAFANA_ENDPOINT=g-xxx.grafana-workspace.eu-central-1.amazonaws.com \
GRAFANA_TOKEN=glsa_xxx \
npx jest test/integ/

# Destroy
cd test/integ && npx cdk destroy --app 'npx ts-node integ-app.ts'
```

## Test Matrix

### Per-construct tests (CDK synth)

| Test | GrafanaFolder | GrafanaDashboard | GrafanaAlertRule | GrafanaContactPoint | GrafanaDatasource | GrafanaNotificationPolicy |
|---|---|---|---|---|---|---|
| Synth properties | x | x | x | x | x | x |
| Secret ARN (not value) | x | x | x | x | x | x |
| IAM grant (secret) | x | x | x | x | x | x |
| IAM grant (S3 asset) | — | x | — | x | — | — |
| Auto dependency (folder construct) | — | x | x | — | — | — |
| Create handler | x | x | x | x | x | x |
| Update handler | x | x | x | x | x | x |
| Delete handler | x | x | x | x | x | x |
| 404 on delete | x | x | x | x | x | x |
| 409 fallback to PUT | — | — | x | x | — | — |
| IAM grant (secureJsonData secret) | — | — | — | — | x | — |
| cdk-nag clean | x | x | x | x | x | x |

### Provider-level tests (tested once)

| Test | Description |
|---|---|
| Singleton provider | Two constructs in one stack share one handler Lambda |
| Log retention | Handler and framework Lambdas have `logRetention` set |
| Reserved concurrency | Handler Lambda has `reservedConcurrentExecutions` set |
| VPC configuration | VPC/subnets/security groups are applied when provided |
| 4xx no retry | Client errors throw immediately without retry |
| 5xx retry | Server errors retry with exponential backoff |
| Network error retry | `fetch` exceptions retry with exponential backoff |
| SM token retry | Secrets Manager transient errors retry; permanent errors throw |
| SM token cache cleared | `tokenCache` is cleared at start of each `onEvent` call |
| S3 asset download | Dashboard JSON is read from S3 and parsed correctly |

### Security tests

| Test | Description |
|---|---|
| Endpoint validation (synth) | Construct throws if `grafanaEndpoint` contains `/`, `?`, `#`, or `@` |
| Endpoint validation (runtime) | Handler throws if `GrafanaEndpoint` fails regex check |
| UID validation | Construct throws if `uid` contains path-traversal characters (`../`, `/`) |
| UID URL encoding | Handler uses `encodeURIComponent` for UIDs in API paths |
| Error truncation | 4xx error messages truncate response body to 200 characters |
| No token in errors | Error messages never include the Authorization header value |
| secureJsonData not in template | `secureJsonData` (ISecret or string) does not appear in synthesized CloudFormation |
| settingsJson not in template | Contact point `settingsJson` does not appear in synthesized CloudFormation |
| Secret policy scoped to role | Documentation example uses Lambda role ARN, not account root |

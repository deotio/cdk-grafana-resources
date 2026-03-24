# 02 — Custom Resource Provider

## Overview

All Grafana constructs delegate to a **single shared Lambda function** that acts as a CloudFormation Custom Resource provider. The Lambda receives the Grafana API parameters in the `ResourceProperties` of the CloudFormation event and translates them into HTTP calls to the Grafana API.

## Why a Single Shared Provider?

Using `AwsCustomResource` (one Lambda per construct) would be simpler but has drawbacks:

- **Cold start multiplication** — each `AwsCustomResource` spins up its own Lambda. A stack with 20 dashboards means 20 Lambdas.
- **No error normalization** — `AwsCustomResource` returns raw SDK/API errors that are opaque in CloudFormation events.
- **Limited control** — cannot implement retry logic, token caching, or request batching.

A single `Provider` (from `aws-cdk-lib/custom-resources`) with one Lambda handles all resource types, caches the API token for the duration of the invocation, and provides clear error messages in CloudFormation events.

## Provider Architecture

```
CloudFormation
    │
    ▼
┌──────────────────────────────┐
│  CDK Provider Framework      │
│  (async waiter built-in)     │
│                              │
│  ┌────────────────────────┐  │
│  │  onEvent Lambda        │  │
│  │                        │  │
│  │  1. Read token from    │  │
│  │     Secrets Manager    │  │
│  │  2. Route by           │  │
│  │     ResourceType       │  │
│  │  3. Call Grafana API   │  │
│  │  4. Return physical ID │  │
│  │     + attributes       │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

## Lambda Handler

### Entry Point

```typescript
// lambda/grafana-provider/index.ts

import {
  CdkCustomResourceEvent,
  CdkCustomResourceResponse,
} from 'aws-lambda';

const VALID_ENDPOINT = /^[a-zA-Z0-9.-]+(:[0-9]+)?$/;

export async function onEvent(
  event: CdkCustomResourceEvent,
): Promise<CdkCustomResourceResponse> {
  // Clear token cache on each CloudFormation invocation to ensure
  // rotated tokens are picked up (the cache is module-level state
  // that persists across warm Lambda invocations).
  tokenCache.clear();

  const props = event.ResourceProperties;

  // Validate required properties
  const resourceType = props.GrafanaResourceType;
  if (!resourceType || !handlers[resourceType]) {
    throw new Error(`Unknown or missing GrafanaResourceType: ${resourceType}`);
  }
  if (!props.GrafanaEndpoint || !props.SecretArn) {
    throw new Error('Missing required properties: GrafanaEndpoint, SecretArn');
  }

  // Validate endpoint to prevent SSRF — must be a hostname, no path/query
  if (!VALID_ENDPOINT.test(props.GrafanaEndpoint)) {
    throw new Error(
      `Invalid GrafanaEndpoint: must be a hostname (optional port), got: ${props.GrafanaEndpoint}`,
    );
  }

  const action = event.RequestType; // 'Create', 'Update', 'Delete'
  const token = await getToken(props.SecretArn);
  const baseUrl = `https://${props.GrafanaEndpoint}`;

  return handlers[resourceType](action, baseUrl, token, props);
}
```

### Handler Interface

Each resource type implements a handler:

```typescript
interface ResourceHandler {
  (
    action: 'Create' | 'Update' | 'Delete',
    baseUrl: string,
    token: string,
    props: Record<string, string>,
  ): Promise<CdkCustomResourceResponse>;
}

const handlers: Record<string, ResourceHandler> = {
  Folder: handleFolder,
  Dashboard: handleDashboard,
  AlertRule: handleAlertRule,
  ContactPoint: handleContactPoint,
  Datasource: handleDatasource,
  NotificationPolicy: handleNotificationPolicy,
};
```

### URL Construction

All user-provided values interpolated into URL paths (UIDs, folder UIDs) must be encoded with `encodeURIComponent()` to prevent path traversal. UIDs are also validated at synth time to match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`, but the runtime encoding is a defense-in-depth measure.

### S3 Asset Property Naming

JSON payloads that may be large or contain secrets are passed via S3 assets. Small, non-sensitive string props remain inline in CloudFormation properties.

| Construct | Prop | S3 Asset? | Property Names |
|---|---|---|---|
| GrafanaDashboard | `dashboardJson` | Yes (always) | `DashboardAssetBucket`, `DashboardAssetKey` |
| GrafanaAlertRule | `ruleJson` | Yes (alert rules with complex queries can be large) | `RuleAssetBucket`, `RuleAssetKey` |
| GrafanaContactPoint | `settingsJson` | Yes (may contain webhook URLs, API keys) | `SettingsAssetBucket`, `SettingsAssetKey` |
| GrafanaDatasource | `jsonDataJson` | No (non-sensitive config, typically small) | `JsonDataJson` (inline) |
| GrafanaDatasource | `secureJsonData` (string) | Yes (may contain credentials) | `SecureJsonDataAssetBucket`, `SecureJsonDataAssetKey` |
| GrafanaDatasource | `secureJsonData` (ISecret) | No — resolved from Secrets Manager at runtime | `SecureJsonDataSecretArn` |
| GrafanaNotificationPolicy | `policyJson` | No (small — one policy tree per workspace) | `PolicyJson` (inline) |

### Example: Folder Handler

```typescript
async function handleFolder(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
): Promise<CdkCustomResourceResponse> {
  const uid = props.Uid;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (action === 'Delete') {
    await grafanaFetch(`${baseUrl}/api/folders/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers,
    });
    return { PhysicalResourceId: uid };
  }

  if (action === 'Create') {
    const result = await grafanaFetch(`${baseUrl}/api/folders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uid, title: props.Title }),
    });
    return {
      PhysicalResourceId: uid,
      Data: { FolderId: String(result.id) },
    };
  }

  // Update
  const result = await grafanaFetch(
    `${baseUrl}/api/folders/${encodeURIComponent(uid)}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ title: props.Title, overwrite: true }),
    },
  );
  return {
    PhysicalResourceId: uid,
    Data: { FolderId: String(result.id) },
  };
}
```

### Example: Dashboard Handler

```typescript
async function handleDashboard(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
): Promise<CdkCustomResourceResponse> {
  const uid = props.Uid;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (action === 'Delete') {
    await grafanaFetch(`${baseUrl}/api/dashboards/uid/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers,
    });
    return { PhysicalResourceId: uid };
  }

  // Create or Update — read dashboard JSON from S3 asset
  const dashboardJson = await downloadAsset(
    props.DashboardAssetBucket,
    props.DashboardAssetKey,
  );
  const dashboard = JSON.parse(dashboardJson);
  dashboard.uid = uid;
  dashboard.id = null;

  // Always use overwrite: true. On Create, the UID may already exist if
  // CloudFormation is replacing the resource (create-before-delete) or if
  // adopting a pre-existing dashboard. This is safe because UIDs are
  // user-provided and stable.
  const body = {
    dashboard,
    folderUid: props.FolderUid,
    overwrite: true,
    message: props.Message || 'Deployed by cdk-grafana-resources',
  };

  const result = await grafanaFetch(`${baseUrl}/api/dashboards/db`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return {
    PhysicalResourceId: uid,
    Data: {
      DashboardId: String(result.id),
      Url: result.url,
      Version: String(result.version),
    },
  };
}
```

### Example: NotificationPolicy Handler

```typescript
async function handleNotificationPolicy(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
): Promise<CdkCustomResourceResponse> {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Disable-Provenance': 'true',
  };

  if (action === 'Delete') {
    // Reset to Grafana's default policy tree
    const defaultPolicy = {
      receiver: 'grafana-default-email',
      group_by: ['grafana_folder', 'alertname'],
      routes: [],
      group_wait: '30s',
      group_interval: '5m',
      repeat_interval: '4h',
    };
    await grafanaFetch(`${baseUrl}/api/v1/provisioning/policies`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(defaultPolicy),
    });
    return { PhysicalResourceId: 'notification-policy' };
  }

  // Create or Update — full replacement
  const policy = JSON.parse(props.PolicyJson);
  await grafanaFetch(`${baseUrl}/api/v1/provisioning/policies`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(policy),
  });

  return { PhysicalResourceId: 'notification-policy' };
}
```

### Example: AlertRule Handler

```typescript
async function handleAlertRule(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
): Promise<CdkCustomResourceResponse> {
  const uid = props.Uid;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Disable-Provenance': 'true',
  };

  if (action === 'Delete') {
    await grafanaFetch(
      `${baseUrl}/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`,
      { method: 'DELETE', headers },
    );
    return { PhysicalResourceId: uid };
  }

  // Read rule JSON from S3 asset
  const ruleJsonStr = await downloadAsset(props.RuleAssetBucket, props.RuleAssetKey);
  const rule = JSON.parse(ruleJsonStr);
  rule.uid = uid;
  rule.folderUID = props.FolderUid;
  rule.ruleGroup = props.RuleGroup;

  if (action === 'Create') {
    try {
      await grafanaFetch(`${baseUrl}/api/v1/provisioning/alert-rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rule),
      });
    } catch (err: unknown) {
      // 409 Conflict — UID already exists (create-before-delete replacement).
      // Fall back to PUT (update).
      if (String(err).includes('409')) {
        await grafanaFetch(
          `${baseUrl}/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`,
          { method: 'PUT', headers, body: JSON.stringify(rule) },
        );
      } else {
        throw err;
      }
    }
  } else {
    // Update
    await grafanaFetch(
      `${baseUrl}/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`,
      { method: 'PUT', headers, body: JSON.stringify(rule) },
    );
  }

  return { PhysicalResourceId: uid };
}
```

### Example: ContactPoint Handler

```typescript
async function handleContactPoint(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
): Promise<CdkCustomResourceResponse> {
  const uid = props.Uid;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Disable-Provenance': 'true',
  };

  if (action === 'Delete') {
    await grafanaFetch(
      `${baseUrl}/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`,
      { method: 'DELETE', headers },
    );
    return { PhysicalResourceId: uid };
  }

  // Read settings from S3 asset (may contain webhook URLs, API keys)
  const settingsStr = await downloadAsset(
    props.SettingsAssetBucket,
    props.SettingsAssetKey,
  );
  const settings = JSON.parse(settingsStr);

  const body = { uid, name: props.Name, type: props.Type, settings };

  if (action === 'Create') {
    try {
      await grafanaFetch(`${baseUrl}/api/v1/provisioning/contact-points`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      // 409 fallback — same as AlertRule
      if (String(err).includes('409')) {
        await grafanaFetch(
          `${baseUrl}/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`,
          { method: 'PUT', headers, body: JSON.stringify(body) },
        );
      } else {
        throw err;
      }
    }
  } else {
    await grafanaFetch(
      `${baseUrl}/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`,
      { method: 'PUT', headers, body: JSON.stringify(body) },
    );
  }

  return { PhysicalResourceId: uid };
}
```

### Example: Datasource Handler

```typescript
async function handleDatasource(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
): Promise<CdkCustomResourceResponse> {
  const uid = props.Uid;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (action === 'Delete') {
    await grafanaFetch(
      `${baseUrl}/api/datasources/uid/${encodeURIComponent(uid)}`,
      { method: 'DELETE', headers },
    );
    return { PhysicalResourceId: uid };
  }

  // Build the datasource object
  const body: Record<string, unknown> = {
    uid,
    name: props.Name,
    type: props.Type,
    access: props.Access || 'proxy',
    isDefault: props.IsDefault === 'true',
  };

  // jsonDataJson is inline (non-sensitive, small)
  if (props.JsonDataJson) {
    body.jsonData = JSON.parse(props.JsonDataJson);
  }

  // secureJsonData: resolved from Secrets Manager OR S3 asset
  if (props.SecureJsonDataSecretArn) {
    const secretValue = await getToken(props.SecureJsonDataSecretArn);
    body.secureJsonData = JSON.parse(secretValue);
  } else if (props.SecureJsonDataAssetBucket) {
    const assetValue = await downloadAsset(
      props.SecureJsonDataAssetBucket,
      props.SecureJsonDataAssetKey,
    );
    body.secureJsonData = JSON.parse(assetValue);
  }

  if (action === 'Create') {
    const result = await grafanaFetch(`${baseUrl}/api/datasources`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return {
      PhysicalResourceId: uid,
      Data: { DatasourceId: String(result.id) },
    };
  }

  // Update
  const result = await grafanaFetch(
    `${baseUrl}/api/datasources/uid/${encodeURIComponent(uid)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );
  return {
    PhysicalResourceId: uid,
    Data: { DatasourceId: String(result.id) },
  };
}
```

### S3 Asset Download Helper

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

async function downloadAsset(
  bucket: string,
  key: string,
  retries = 3,
): Promise<string> {
  const client = new S3Client({});

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return await response.Body!.transformToString('utf-8');
    } catch (err) {
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`Failed to download asset s3://${bucket}/${key}: ${err}`);
    }
  }

  throw new Error(`Failed to download asset after ${retries + 1} attempts`);
}
```

## Token Retrieval & Caching

The cache is keyed by `secretArn`, so a single stack can target **multiple Grafana endpoints** with different tokens — each secret is fetched and cached independently.

```typescript
const tokenCache = new Map<string, string>();

async function getToken(secretArn: string, retries = 3): Promise<string> {
  // Cache within a single Lambda invocation (covers multiple
  // Custom Resource events when CloudFormation batches them)
  const cached = tokenCache.get(secretArn);
  if (cached) {
    return cached;
  }

  const client = new SecretsManagerClient({});

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.send(
        new GetSecretValueCommand({ SecretId: secretArn }),
      );

      const value = response.SecretString;
      if (!value) {
        throw new Error(`Secret ${secretArn} has no string value`);
      }

      tokenCache.set(secretArn, value);
      return value;
    } catch (err: unknown) {
      // Don't retry permanent errors (AccessDenied, ResourceNotFound)
      const code = (err as { name?: string }).name ?? '';
      if (['AccessDeniedException', 'ResourceNotFoundException'].includes(code)) {
        throw err;
      }
      // Retry transient errors (throttling, network)
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to retrieve secret ${secretArn} after ${retries + 1} attempts`);
}
```

## HTTP Client Wrapper

A thin wrapper around `fetch` with retry logic for transient errors:

```typescript
async function grafanaFetch(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (err) {
      // Network errors (DNS failure, connection reset, timeout) — retry
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(
        `Grafana API network error after ${retries + 1} attempts: ${init.method} ${url}: ${err}`,
      );
    }

    if (response.ok) {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }

    // Don't retry client errors (4xx) — these indicate a bug in the input
    if (response.status >= 400 && response.status < 500) {
      // Special case: 404 on Delete is not an error (resource already gone)
      if (init.method === 'DELETE' && response.status === 404) {
        return {};
      }
      const body = await response.text();
      // Truncate response body to avoid leaking Grafana internals
      // into CloudFormation events (visible to cloudformation:DescribeStackEvents)
      const safeBody = body.length > 200 ? body.slice(0, 200) + '...' : body;
      throw new Error(
        `Grafana API ${response.status}: ${safeBody} (${init.method} ${url})`,
      );
    }

    // Retry on 5xx
    if (attempt < retries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(`Grafana API failed after ${retries + 1} attempts: ${init.method} ${url}`);
}
```

### Error handling principles

| Scenario | Behavior | Rationale |
|---|---|---|
| 2xx | Return parsed response | Success |
| 404 on DELETE | Return empty (success) | Resource already gone — idempotent |
| 4xx (other) | Throw immediately, no retry | Client error — bad input, will never succeed |
| 5xx | Retry with exponential backoff | Transient server error |
| Network error (`fetch` throws) | Retry with exponential backoff | DNS failure, connection reset, timeout — transient |

## Logging Policy

The Lambda must not log sensitive data. CloudWatch Logs have broader access than Secrets Manager and may be forwarded to centralized logging systems.

**Do log:**
- Resource type, action, and UID (e.g., `Dashboard Create uid=my-dash`)
- HTTP status codes from Grafana API responses
- Retry attempts and backoff durations
- Validation failures (invalid endpoint, unknown resource type)

**Never log:**
- API tokens or Authorization header values
- Grafana API request or response bodies (may contain dashboard content, datasource secrets, or alert rule definitions)
- Secret ARNs beyond what's already in the CloudFormation event

```typescript
// Example: safe structured logging
console.log(JSON.stringify({
  action,
  resourceType,
  uid: props.Uid,
  status: response.status,
}));
```

## CDK Provider Integration

The constructs register with a singleton Provider per stack:

```typescript
// lib/grafana-provider.ts

import { Provider } from 'aws-cdk-lib/custom-resources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface GrafanaProviderProps {
  /**
   * CloudWatch Logs retention for the provider Lambda and framework Lambdas.
   * @default logs.RetentionDays.ONE_WEEK
   */
  readonly logRetention?: logs.RetentionDays;

  /**
   * VPC to place the provider Lambda in.
   * Required when the Grafana endpoint is only reachable from within a VPC
   * or has IP allowlisting.
   */
  readonly vpc?: ec2.IVpc;

  /** Subnet selection for the Lambda when deployed in a VPC. */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /** Security groups for the Lambda when deployed in a VPC. */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Maximum number of concurrent Lambda invocations.
   * Limits blast radius on Grafana API rate limits and prevents consuming
   * account-level Lambda concurrency.
   * @default 10
   */
  readonly reservedConcurrentExecutions?: number;
}

export class GrafanaProvider extends Construct {
  public readonly provider: Provider;

  /** The Lambda handler function. Exposed so constructs can grant it
   *  additional permissions (e.g., S3 asset read). */
  public readonly handler: NodejsFunction;

  /**
   * Returns the singleton GrafanaProvider for the given stack,
   * creating it if it doesn't exist.
   *
   * Props are only used on first creation. If the provider already exists,
   * props are ignored. Place the first construct that creates the provider
   * early in the stack to control its configuration.
   */
  public static getOrCreate(scope: Construct, props?: GrafanaProviderProps): GrafanaProvider {
    const stack = Stack.of(scope);
    const id = 'GrafanaCustomResourceProvider';
    const existing = stack.node.tryFindChild(id) as GrafanaProvider;
    return existing || new GrafanaProvider(stack, id, props);
  }

  private constructor(scope: Construct, id: string, props?: GrafanaProviderProps) {
    super(scope, id);

    this.handler = new NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '..', 'lambda', 'grafana-provider', 'index.ts'),
      runtime: Runtime.NODEJS_22_X,
      handler: 'onEvent',
      timeout: Duration.minutes(5),
      memorySize: 256,
      description: 'cdk-grafana-resources: manages Grafana resources via HTTP API',
      logRetention: props?.logRetention ?? logs.RetentionDays.ONE_WEEK,
      bundling: {
        externalModules: ['@aws-sdk/*'], // available in Lambda runtime
      },
      reservedConcurrentExecutions: props?.reservedConcurrentExecutions ?? 10,
      // Optional VPC configuration for Grafana instances behind a VPC or IP allowlist
      vpc: props?.vpc,
      vpcSubnets: props?.vpcSubnets,
      securityGroups: props?.securityGroups,
    });

    this.provider = new Provider(this, 'Provider', {
      onEventHandler: this.handler,
      logRetention: props?.logRetention ?? logs.RetentionDays.ONE_WEEK,
    });
  }

  /**
   * Grant the Lambda permission to read a specific secret.
   * Called by each construct that uses a different secret.
   */
  public grantSecretRead(secret: secretsmanager.ISecret): void {
    secret.grantRead(this.handler);
  }
}
```

### How constructs use the provider

All JSON payloads that may contain sensitive data (dashboard JSON, contact point
settings, datasource secureJsonData) are uploaded as S3 assets or resolved from
Secrets Manager — they never flow through CloudFormation resource properties.

#### `writeJsonToTempFile` helper

Writes a JSON string to a temp file and returns its path, for use with `s3_assets.Asset`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

function writeJsonToTempFile(json: string): string {
  // Hash the content to produce a stable filename — same content = same
  // file = same asset hash, avoiding unnecessary CloudFormation updates.
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  const filePath = path.join(os.tmpdir(), `cdk-grafana-${hash}.json`);
  fs.writeFileSync(filePath, json, 'utf-8');
  return filePath;
}
```

#### Example: GrafanaDashboard constructor wiring

```typescript
// Inside GrafanaDashboard constructor:
const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
provider.grantSecretRead(props.apiTokenSecret);

// Resolve folderUid: GrafanaFolder | string → string
const resolvedFolderUid = props.folderUid instanceof GrafanaFolder
  ? props.folderUid.uid
  : props.folderUid;

if (props.folderUid instanceof GrafanaFolder) {
  this.node.addDependency(props.folderUid);
}

// Upload dashboard JSON as S3 asset
const asset = new s3_assets.Asset(this, 'DashboardAsset', {
  path: writeJsonToTempFile(props.dashboardJson),
});
asset.grantRead(provider.handler);

new CustomResource(this, 'Resource', {
  serviceToken: provider.provider.serviceToken,
  properties: {
    GrafanaResourceType: 'Dashboard',
    GrafanaEndpoint: props.grafanaEndpoint,
    SecretArn: props.apiTokenSecret.secretArn,
    Uid: props.uid,
    FolderUid: resolvedFolderUid,
    DashboardAssetBucket: asset.s3BucketName,
    DashboardAssetKey: asset.s3ObjectKey,
    Message: props.message,
  },
});
```

#### Example: GrafanaDatasource constructor wiring (secureJsonData)

```typescript
// Inside GrafanaDatasource constructor:
const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
provider.grantSecretRead(props.apiTokenSecret);

const crProps: Record<string, string> = {
  GrafanaResourceType: 'Datasource',
  GrafanaEndpoint: props.grafanaEndpoint,
  SecretArn: props.apiTokenSecret.secretArn,
  Uid: props.uid,
  Name: props.name,
  Type: props.type,
  Access: props.access ?? 'proxy',
  IsDefault: String(props.isDefault ?? false),
};

if (props.jsonDataJson) {
  crProps.JsonDataJson = props.jsonDataJson; // inline — non-sensitive, small
}

// secureJsonData: ISecret → pass ARN; string → upload S3 asset
if (props.secureJsonData) {
  if (typeof props.secureJsonData === 'string') {
    const asset = new s3_assets.Asset(this, 'SecureJsonDataAsset', {
      path: writeJsonToTempFile(props.secureJsonData),
    });
    asset.grantRead(provider.handler);
    crProps.SecureJsonDataAssetBucket = asset.s3BucketName;
    crProps.SecureJsonDataAssetKey = asset.s3ObjectKey;
  } else {
    // ISecret — Lambda resolves the value at runtime
    provider.grantSecretRead(props.secureJsonData);
    crProps.SecureJsonDataSecretArn = props.secureJsonData.secretArn;
  }
}

new CustomResource(this, 'Resource', {
  serviceToken: provider.provider.serviceToken,
  properties: crProps,
});
```

## Lambda Bundling

The Lambda source is organized as a standalone TypeScript project. `NodejsFunction` bundles it with esbuild at synth time — no pre-compilation step is needed.

```
lambda/
└── grafana-provider/
    ├── index.ts          # Entry point
    ├── handlers/
    │   ├── folder.ts
    │   ├── dashboard.ts
    │   ├── alert-rule.ts
    │   ├── contact-point.ts
    │   ├── datasource.ts
    │   └── notification-policy.ts
    ├── grafana-client.ts # HTTP wrapper + retry logic
    ├── s3-asset.ts       # S3 asset download helper
    └── token.ts          # Secrets Manager retrieval + caching
```

### Bundling

The Lambda uses `NodejsFunction` which automatically bundles TypeScript with esbuild at synth time. This is the primary approach because:

- Consumers don't need a separate build step for the Lambda
- CDK handles esbuild automatically (Docker fallback if esbuild is not installed locally)
- Zero runtime dependencies — uses native `fetch` (Node.js 22) and `@aws-sdk/client-secrets-manager` (Lambda runtime)

`@aws-sdk/*` modules are marked as `externalModules` since they are available in the Lambda runtime.

## Update Detection

CloudFormation triggers an Update when any `ResourceProperties` value changes. For dashboards, this means any change to the JSON triggers a redeployment — which is the desired behavior.

To avoid unnecessary updates when the JSON is semantically identical but formatted differently, consumers should ensure consistent formatting (e.g., `JSON.stringify(json, null, 2)`) in their build pipeline. The construct does not normalize JSON — this is intentional, to avoid hiding changes.

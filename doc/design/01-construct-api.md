# 01 — Construct API

## Shared Props

All constructs share a base set of properties for connecting to the Grafana workspace:

```typescript
export interface GrafanaResourceProps {
  /**
   * The Grafana workspace endpoint (hostname only, without protocol).
   * Must be a valid hostname — no path, query string, or userinfo.
   * Example: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com'
   *
   * Validated at synth time (construct constructor) and at deploy time
   * (Lambda handler) to prevent SSRF.
   */
  readonly grafanaEndpoint: string;

  /**
   * The Secrets Manager secret containing the Grafana API token.
   * The secret value must be a plain string (the token), not JSON.
   */
  readonly apiTokenSecret: secretsmanager.ISecret;

  /**
   * Configuration for the shared Custom Resource provider Lambda.
   * Only takes effect on the first construct in the stack that creates
   * the provider. Subsequent constructs reuse the existing provider.
   * @default - provider created with default settings (log retention: ONE_WEEK, no VPC)
   */
  readonly providerProps?: GrafanaProviderProps;
}
```

### Input Validation

All constructs validate inputs at synth time (in the constructor):

| Prop | Validation | Rationale |
|---|---|---|
| `grafanaEndpoint` | Must match `/^[a-zA-Z0-9.-]+(:[0-9]+)?$/` — hostname with optional port, no path/query/userinfo | Prevents SSRF via path injection |
| `uid` | Must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` | Prevents URL path traversal when interpolated into API paths |

The Lambda handler re-validates `grafanaEndpoint` at deploy time as a defense-in-depth measure.

### Why `ISecret` and not a plain string?

- Tokens must never appear in CloudFormation templates or state
- `ISecret` supports both same-account and cross-account secrets via `Secret.fromSecretCompleteArn()`
- The Custom Resource Lambda resolves the secret value at runtime

---

## GrafanaFolder

Creates or updates a Grafana folder.

```typescript
export interface GrafanaFolderProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the folder.
   * Used for idempotent create/update. Cannot be changed after creation.
   * Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ (validated at synth time).
   * Example: 'my-app-prod'
   */
  readonly uid: string;

  /**
   * Display title of the folder in Grafana.
   */
  readonly title: string;
}

export class GrafanaFolder extends Construct {
  /** The folder UID (same as input — exposed for cross-referencing). */
  public readonly uid: string;

  /** The Grafana-assigned numeric folder ID. */
  public readonly folderId: string;

  /** Pass-through of the API token secret for reuse by child constructs. */
  public readonly apiTokenSecret: secretsmanager.ISecret;
}
```

### API Mapping

| Lifecycle | HTTP Method | Endpoint | Key Fields |
|---|---|---|---|
| Create | `POST` | `/api/folders` | `{ uid, title }` |
| Update | `PUT` | `/api/folders/{uid}` | `{ title, overwrite: true }` |
| Delete | `DELETE` | `/api/folders/{uid}` | — |

### Physical Resource ID

The folder `uid` (user-provided, stable).

---

## GrafanaDashboard

Creates or updates a dashboard within a folder.

```typescript
export interface GrafanaDashboardProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the dashboard.
   * If the dashboard JSON contains a `uid` field, this prop takes precedence.
   */
  readonly uid: string;

  /**
   * The folder to place the dashboard in.
   * Accepts a GrafanaFolder construct (recommended — automatically creates
   * a CloudFormation dependency) or a plain UID string.
   */
  readonly folderUid: GrafanaFolder | string;

  /**
   * The dashboard model as a JSON string.
   * This is the `dashboard` object from Grafana's export format.
   * The `id` field will be set to `null` and `uid` will be overridden
   * to ensure idempotent create/update behavior.
   *
   * The construct uploads this JSON to S3 as a CDK asset and passes the
   * S3 location to the Lambda, which reads it at deploy time. This avoids
   * the ~8KB CloudFormation Custom Resource payload limit.
   */
  readonly dashboardJson: string;

  /**
   * Optional commit message shown in Grafana's dashboard version history.
   * Defaults to 'Deployed by cdk-grafana-resources'.
   */
  readonly message?: string;
}

export class GrafanaDashboard extends Construct {
  /** The dashboard UID (same as input). */
  public readonly uid: string;

  /** The Grafana-assigned numeric dashboard ID. */
  public readonly dashboardId: string;

  /** The dashboard URL path (e.g., '/d/abc123/my-dashboard'). */
  public readonly url: string;

  /** The dashboard version number (increments on each update). */
  public readonly version: string;
}
```

### API Mapping

| Lifecycle | HTTP Method | Endpoint | Key Fields |
|---|---|---|---|
| Create | `POST` | `/api/dashboards/db` | `{ dashboard: { uid, ... }, folderUid, overwrite: true }` |
| Update | `POST` | `/api/dashboards/db` | `{ dashboard: { uid, ... }, folderUid, overwrite: true }` |
| Delete | `DELETE` | `/api/dashboards/uid/{uid}` | — |

> Both Create and Update use `overwrite: true`. This makes creates idempotent (safe to retry) and handles CloudFormation's create-before-delete replacement pattern where the old resource with the same UID may still exist.

### Dashboard JSON Handling

At **synth time**, the construct writes `dashboardJson` to a temporary file and uploads it as a CDK S3 asset. The asset hash triggers CloudFormation updates when the JSON changes.

At **deploy time**, the Lambda:
1. Downloads the JSON from S3 using the asset bucket/key from the Custom Resource properties
2. Parses the JSON string
3. Sets `dashboard.uid` to the construct's `uid` prop
4. Sets `dashboard.id` to `null` (required for create via API)
5. Wraps it in the API envelope: `{ dashboard, folderUid, overwrite: true, message }`

This means users can export a dashboard from the Grafana UI, drop the JSON into their repo, and the construct handles the rest — regardless of JSON size.

---

## GrafanaAlertRule

Creates or updates a Grafana-managed alert rule.

```typescript
export interface GrafanaAlertRuleProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the alert rule.
   */
  readonly uid: string;

  /**
   * The folder containing this alert rule.
   * Accepts a GrafanaFolder construct (recommended — automatically creates
   * a CloudFormation dependency) or a plain UID string.
   */
  readonly folderUid: GrafanaFolder | string;

  /**
   * The alert rule group name. Rules within the same group are evaluated together.
   */
  readonly ruleGroup: string;

  /**
   * The alert rule definition as a JSON string.
   * This is the rule object from Grafana's provisioning API export.
   * The `uid` field will be overridden with this construct's uid prop.
   *
   * Uploaded as a CDK S3 asset (alert rules with complex queries can
   * exceed the ~8KB CloudFormation payload limit).
   */
  readonly ruleJson: string;
}

export class GrafanaAlertRule extends Construct {
  /** The alert rule UID. */
  public readonly uid: string;
}
```

### API Mapping

| Lifecycle | HTTP Method | Endpoint | Key Fields |
|---|---|---|---|
| Create | `POST` | `/api/v1/provisioning/alert-rules` | Rule object with `uid`, `folderUID`, `ruleGroup` |
| Update | `PUT` | `/api/v1/provisioning/alert-rules/{uid}` | Full rule object |
| Delete | `DELETE` | `/api/v1/provisioning/alert-rules/{uid}` | — |

> The provisioning API returns 409 Conflict if a Create is attempted with an existing UID. To handle CloudFormation's create-before-delete replacement pattern, the Create handler falls back to a PUT (update) on 409. This mirrors the dashboard's `overwrite: true` behavior.

### Header: `X-Disable-Provenance`

All provisioning API calls include `X-Disable-Provenance: true` so that rules can still be edited in the Grafana UI if needed. This is a pragmatic default — purely code-managed rules can be enforced via Grafana's provisioning provenance settings at the workspace level.

---

## GrafanaContactPoint

Creates or updates a contact point for alert notifications.

```typescript
export interface GrafanaContactPointProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the contact point.
   */
  readonly uid: string;

  /**
   * Display name of the contact point.
   */
  readonly name: string;

  /**
   * The contact point type (e.g., 'email', 'slack', 'opsgenie', 'pagerduty', 'webhook').
   */
  readonly type: string;

  /**
   * Type-specific settings as a JSON string.
   * See Grafana docs for the settings schema of each type.
   *
   * **Security note:** Contact point settings often contain sensitive values
   * (Slack webhook URLs, PagerDuty routing keys, OpsGenie API keys). This
   * prop is uploaded as a CDK S3 asset — it does NOT appear in
   * CloudFormation state. For additional protection, use Grafana's
   * `secureSettings` field within the JSON, which Grafana stores encrypted.
   */
  readonly settingsJson: string;
}

export class GrafanaContactPoint extends Construct {
  /** The contact point UID. */
  public readonly uid: string;
}
```

### API Mapping

| Lifecycle | HTTP Method | Endpoint | Key Fields |
|---|---|---|---|
| Create | `POST` | `/api/v1/provisioning/contact-points` | `{ uid, name, type, settings }` |
| Update | `PUT` | `/api/v1/provisioning/contact-points/{uid}` | Full object |
| Delete | `DELETE` | `/api/v1/provisioning/contact-points/{uid}` | — |

> Same 409-to-PUT fallback as AlertRule for create-before-delete safety.

---

## GrafanaDatasource

Creates or updates a datasource.

```typescript
export interface GrafanaDatasourceProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the datasource.
   */
  readonly uid: string;

  /**
   * Display name of the datasource.
   */
  readonly name: string;

  /**
   * Datasource type (e.g., 'cloudwatch', 'prometheus', 'elasticsearch').
   */
  readonly type: string;

  /**
   * Datasource access mode. Default: 'proxy'.
   */
  readonly access?: 'proxy' | 'direct';

  /**
   * Type-specific configuration as a JSON string.
   * Merged into the `jsonData` field of the Grafana API request.
   */
  readonly jsonDataJson?: string;

  /**
   * Secrets for the datasource (e.g., database passwords, API keys).
   * Merged into the `secureJsonData` field. Values are stored encrypted
   * in Grafana after creation.
   *
   * Accepts either:
   * - An `ISecret` whose value is a JSON string — resolved at deploy time
   *   by the Lambda. The secret value never appears in CloudFormation state.
   * - A plain JSON string — uploaded as a CDK S3 asset (not stored in
   *   CloudFormation properties). Use this for values that are not
   *   sensitive enough to warrant a Secrets Manager secret.
   *
   * **Security note:** Prefer `ISecret` for production datasources.
   */
  readonly secureJsonData?: secretsmanager.ISecret | string;

  /**
   * Whether this is the default datasource of its type.
   * Default: false.
   */
  readonly isDefault?: boolean;
}

export class GrafanaDatasource extends Construct {
  /** The datasource UID. */
  public readonly uid: string;

  /** The Grafana-assigned numeric datasource ID. */
  public readonly datasourceId: string;
}
```

### API Mapping

| Lifecycle | HTTP Method | Endpoint | Key Fields |
|---|---|---|---|
| Create | `POST` | `/api/datasources` | Full datasource object |
| Update | `PUT` | `/api/datasources/uid/{uid}` | Full datasource object |
| Delete | `DELETE` | `/api/datasources/uid/{uid}` | — |

---

## GrafanaNotificationPolicy

Manages the notification policy tree (routing of alerts to contact points).

```typescript
export interface GrafanaNotificationPolicyProps extends GrafanaResourceProps {
  /**
   * The notification policy tree as a JSON string.
   * This replaces the entire policy tree — Grafana only supports
   * a single policy tree, not individual policy CRUD.
   */
  readonly policyJson: string;
}

export class GrafanaNotificationPolicy extends Construct {
  // No outputs — the policy tree is a singleton resource.
}
```

### API Mapping

| Lifecycle | HTTP Method | Endpoint | Notes |
|---|---|---|---|
| Create | `PUT` | `/api/v1/provisioning/policies` | Grafana always has a default policy; this replaces it |
| Update | `PUT` | `/api/v1/provisioning/policies` | Same as create — full replacement |
| Delete | `PUT` | `/api/v1/provisioning/policies` | Resets to Grafana's default policy |

### Physical Resource ID

A synthetic stable ID: `notification-policy`. Since only one policy tree exists per workspace, this value is fixed.

### Delete Behavior

Delete resets the policy tree to Grafana's default (a single root policy with `continue: false` and the default contact point). The Lambda PUTs the default policy object:

```typescript
const defaultPolicy = {
  receiver: 'grafana-default-email',
  group_by: ['grafana_folder', 'alertname'],
  routes: [],
  group_wait: '30s',
  group_interval: '5m',
  repeat_interval: '4h',
};
```

### Note on Singleton Behavior

Unlike other constructs, the notification policy is a singleton per Grafana workspace. Only one `GrafanaNotificationPolicy` should exist per workspace. The construct does not enforce this — multiple stacks targeting the same workspace would overwrite each other. This is documented as a known limitation.

---

## Dependency Ordering

Constructs that reference a folder accept `GrafanaFolder | string` for `folderUid`. When a `GrafanaFolder` construct is passed, the construct automatically creates a CloudFormation dependency and resolves the UID:

```typescript
const folder = new GrafanaFolder(this, 'Folder', { ... });

const dashboard = new GrafanaDashboard(this, 'Dashboard', {
  folderUid: folder, // automatic CloudFormation dependency
  ...
});
```

Internally, the construct resolves the prop in its constructor:

```typescript
// Inside GrafanaDashboard / GrafanaAlertRule constructor:
const resolvedFolderUid = props.folderUid instanceof GrafanaFolder
  ? props.folderUid.uid
  : props.folderUid;

if (props.folderUid instanceof GrafanaFolder) {
  this.node.addDependency(props.folderUid);
}
```

Passing a plain string UID is still supported for cross-stack references or pre-existing folders, but no automatic dependency is created — the user must call `node.addDependency()` manually in that case.

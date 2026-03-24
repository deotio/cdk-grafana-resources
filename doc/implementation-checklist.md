# Implementation Checklist

Work is divided into **parallel tracks** that can be assigned to independent agents.
Each track produces a self-contained deliverable with clear inputs and outputs.
Tracks are ordered by dependency — tracks with no upstream dependency can start
immediately.

---

## Track 1 — Lambda Handler (no dependencies)

All code in `lambda/grafana-provider/`. Pure TypeScript, no CDK imports.

- [ ] **1.1** `grafana-client.ts` — `grafanaFetch` wrapper
  - Retry on 5xx and network errors with exponential backoff (max 10s)
  - No retry on 4xx; 404 on DELETE returns `{}`
  - Truncate error response body to 200 chars
  - Never include Authorization header in error messages
- [ ] **1.2** `token.ts` — `getToken` with retry + cache
  - Module-level `tokenCache: Map<string, string>`
  - Retry transient SM errors; no retry on AccessDenied / ResourceNotFound
  - Export `clearTokenCache()` for use by entry point
- [ ] **1.3** `s3-asset.ts` — `downloadAsset` with retry
  - Same backoff pattern as `grafanaFetch`
  - Return UTF-8 string from S3 `Body`
- [ ] **1.4** `handlers/folder.ts` — `handleFolder`
  - POST create, PUT update, DELETE delete
  - `encodeURIComponent(uid)` on all URL paths
  - Return `PhysicalResourceId: uid`, `Data: { FolderId }`
- [ ] **1.5** `handlers/dashboard.ts` — `handleDashboard`
  - Download JSON from S3 asset (`DashboardAssetBucket`/`DashboardAssetKey`)
  - Set `dashboard.uid`, `dashboard.id = null`, `overwrite: true`
  - Return `PhysicalResourceId: uid`, `Data: { DashboardId, Url, Version }`
- [ ] **1.6** `handlers/alert-rule.ts` — `handleAlertRule`
  - Download rule JSON from S3 asset (`RuleAssetBucket`/`RuleAssetKey`)
  - POST create with 409-to-PUT fallback
  - Include `X-Disable-Provenance: true` header
  - `encodeURIComponent(uid)` on all URL paths
- [ ] **1.7** `handlers/contact-point.ts` — `handleContactPoint`
  - Download settings from S3 asset (`SettingsAssetBucket`/`SettingsAssetKey`)
  - POST create with 409-to-PUT fallback
  - Include `X-Disable-Provenance: true` header
- [ ] **1.8** `handlers/datasource.ts` — `handleDatasource`
  - `jsonDataJson` read inline from props
  - `secureJsonData` resolved from SM (if `SecureJsonDataSecretArn`) or S3 asset (if `SecureJsonDataAssetBucket`)
  - POST create, PUT update (different endpoints: `/api/datasources` vs `/api/datasources/uid/{uid}`)
- [ ] **1.9** `handlers/notification-policy.ts` — `handleNotificationPolicy`
  - `policyJson` read inline from props (small payload)
  - PUT for create, update, and delete (delete resets to hardcoded Grafana default)
  - Include `X-Disable-Provenance: true` header
  - Return `PhysicalResourceId: 'notification-policy'`
- [ ] **1.10** `index.ts` — entry point
  - `tokenCache.clear()` at start of every `onEvent`
  - Validate `GrafanaEndpoint` against `/^[a-zA-Z0-9.-]+(:[0-9]+)?$/`
  - Validate required props (`GrafanaResourceType`, `GrafanaEndpoint`, `SecretArn`)
  - Route to handler by `GrafanaResourceType`
  - Structured logging: resource type, action, UID, HTTP status only

**Output:** All files in `lambda/grafana-provider/` compile and export `onEvent`.

---

## Track 2 — CDK Constructs (no dependencies, parallel with Track 1)

All code in `lib/`. Depends on `aws-cdk-lib` and `constructs` as peer deps.

- [ ] **2.1** `grafana-provider.ts` — singleton `GrafanaProvider`
  - `GrafanaProviderProps` interface: `logRetention`, `vpc`, `vpcSubnets`, `securityGroups`, `reservedConcurrentExecutions`
  - `getOrCreate(scope, props?)` static method with `tryFindChild` pattern
  - `NodejsFunction` with `entry` pointing to `../lambda/grafana-provider/index.ts`
  - `externalModules: ['@aws-sdk/*']`, runtime `NODEJS_22_X`, timeout 5 min, memory 256 MB
  - `logRetention` default `ONE_WEEK`, `reservedConcurrentExecutions` default `10`
  - Expose `handler: NodejsFunction` and `provider: Provider` as public
  - `grantSecretRead(secret)` method
- [ ] **2.2** Shared validation helpers (`lib/validation.ts`)
  - `validateEndpoint(endpoint: string)` — throws if fails `/^[a-zA-Z0-9.-]+(:[0-9]+)?$/`
  - `validateUid(uid: string)` — throws if fails `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
  - `writeJsonToTempFile(json: string): string` — SHA-256 hash filename in `os.tmpdir()`
- [ ] **2.3** `grafana-folder.ts` — `GrafanaFolder` construct
  - Extends `Construct`, implements `GrafanaFolderProps extends GrafanaResourceProps`
  - Validate `uid` and `grafanaEndpoint` in constructor
  - Call `GrafanaProvider.getOrCreate`, `grantSecretRead`
  - Create `CustomResource` with inline props (`Uid`, `Title`)
  - Expose `uid`, `folderId` (from CR `GetAtt`), `apiTokenSecret`
- [ ] **2.4** `grafana-dashboard.ts` — `GrafanaDashboard` construct
  - Resolve `folderUid: GrafanaFolder | string` → string + `addDependency`
  - Upload `dashboardJson` as S3 asset via `writeJsonToTempFile`
  - `asset.grantRead(provider.handler)`
  - Pass `DashboardAssetBucket`, `DashboardAssetKey` to CR
  - Expose `uid`, `dashboardId`, `url`, `version`
- [ ] **2.5** `grafana-alert-rule.ts` — `GrafanaAlertRule` construct
  - Resolve `folderUid: GrafanaFolder | string`
  - Upload `ruleJson` as S3 asset
  - Pass `RuleAssetBucket`, `RuleAssetKey`, `FolderUid`, `RuleGroup` to CR
  - Expose `uid`
- [ ] **2.6** `grafana-contact-point.ts` — `GrafanaContactPoint` construct
  - Upload `settingsJson` as S3 asset
  - Pass `SettingsAssetBucket`, `SettingsAssetKey`, `Name`, `Type` to CR
  - Expose `uid`
- [ ] **2.7** `grafana-datasource.ts` — `GrafanaDatasource` construct
  - `secureJsonData?: ISecret | string` handling:
    - `ISecret` → `grantSecretRead`, pass `SecureJsonDataSecretArn`
    - `string` → S3 asset, pass `SecureJsonDataAssetBucket`/`Key`
  - `jsonDataJson` passed inline
  - Pass `Name`, `Type`, `Access`, `IsDefault` to CR
  - Expose `uid`, `datasourceId`
- [ ] **2.8** `grafana-notification-policy.ts` — `GrafanaNotificationPolicy` construct
  - `policyJson` passed inline to CR (small payload)
  - No UID prop — synthetic physical resource ID
  - No outputs
- [ ] **2.9** `index.ts` — barrel export of all constructs + `GrafanaProviderProps`

**Output:** All files in `lib/` compile. `npm run build` succeeds.

---

## Track 3 — Lambda Unit Tests (depends on Track 1)

All code in `test/lambda/`. Mocks `fetch`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-s3`.

- [ ] **3.1** `grafana-client.test.ts`
  - 2xx returns parsed JSON
  - 4xx throws immediately (no retry), error body truncated to 200 chars
  - 404 on DELETE returns `{}`
  - 5xx retries with backoff, succeeds on 2nd attempt
  - Network error (fetch throws) retries
  - Error messages never contain Authorization header
- [ ] **3.2** `token.test.ts`
  - Returns secret string, caches by ARN
  - Retries on throttling, throws on AccessDeniedException
  - `clearTokenCache()` actually clears
- [ ] **3.3** `s3-asset.test.ts`
  - Downloads and returns UTF-8 string
  - Retries on transient S3 errors
- [ ] **3.4** `folder-handler.test.ts` — Create/Update/Delete + 404 on delete
- [ ] **3.5** `dashboard-handler.test.ts` — Create (overwrite=true), Update, Delete, 404 on delete, S3 asset download
- [ ] **3.6** `alert-rule-handler.test.ts` — Create, Create with 409 fallback to PUT, Update, Delete
- [ ] **3.7** `contact-point-handler.test.ts` — same pattern as 3.6 + S3 asset for settings
- [ ] **3.8** `datasource-handler.test.ts` — Create/Update/Delete, secureJsonData from SM, secureJsonData from S3, jsonDataJson inline
- [ ] **3.9** `notification-policy-handler.test.ts` — Create (PUT), Update (PUT), Delete (PUT with default policy)
- [ ] **3.10** `index.test.ts`
  - tokenCache cleared on each call
  - Invalid endpoint rejected
  - Missing required props rejected
  - Unknown resource type rejected
  - Routes to correct handler

**Output:** `npx jest test/lambda/` passes.

---

## Track 4 — Construct Unit Tests (depends on Track 2)

All code in `test/`. Uses `aws-cdk-lib/assertions`.

- [ ] **4.1** `grafana-provider.test.ts`
  - Singleton: two constructs → one handler Lambda (match by description)
  - Log retention set on handler and framework
  - Reserved concurrency set
  - VPC config applied when provided
  - providerProps from first construct used
- [ ] **4.2** `grafana-folder.test.ts`
  - Synth properties correct
  - Secret ARN (not value) in template
  - IAM grant for secret
  - Invalid UID throws at synth
  - Invalid endpoint throws at synth
- [ ] **4.3** `grafana-dashboard.test.ts`
  - Synth properties: `DashboardAssetBucket`/`Key` present, no `DashboardJson`
  - Auto dependency when `folderUid` is `GrafanaFolder`
  - No auto dependency when `folderUid` is string
  - IAM grant for secret + S3 asset
- [ ] **4.4** `grafana-alert-rule.test.ts`
  - `RuleAssetBucket`/`Key` present
  - Auto dependency on folder
  - IAM grant for S3 asset
- [ ] **4.5** `grafana-contact-point.test.ts`
  - `SettingsAssetBucket`/`Key` present
  - IAM grant for S3 asset
- [ ] **4.6** `grafana-datasource.test.ts`
  - `secureJsonData` as ISecret → `SecureJsonDataSecretArn` in template, IAM grant for both secrets
  - `secureJsonData` as string → `SecureJsonDataAssetBucket`/`Key`, IAM grant for S3
  - `secureJsonData` absent → neither prop in template
  - `jsonDataJson` inline in template
- [ ] **4.7** `grafana-notification-policy.test.ts`
  - `PolicyJson` inline in template
  - Secret ARN present
- [ ] **4.8** cdk-nag validation
  - `AwsSolutionsChecks` on a stack with one of each construct → zero errors
- [ ] **4.9** Security-specific tests
  - Endpoint with `/` throws at synth
  - Endpoint with `?` throws at synth
  - UID with `../` throws at synth
  - `secureJsonData` (string) not in synthesized CloudFormation template
  - `settingsJson` not in synthesized CloudFormation template

**Output:** `npx jest test/` passes (excluding `test/lambda/` which is Track 3).

---

## Track 5 — Project Scaffolding (no dependencies, parallel with all)

- [ ] **5.1** `package.json` — name, version, peer deps, dev deps, scripts, files, keywords
- [ ] **5.2** `tsconfig.json` + `tsconfig.dev.json`
- [ ] **5.3** `.eslintrc.json` + `.prettierrc`
- [ ] **5.4** `jest.config.ts` — ts-jest, separate projects for `test/` and `test/lambda/`
- [ ] **5.5** `.gitignore` — `node_modules`, `lib/**/*.js`, `lib/**/*.d.ts`, `cdk.out`, `.doc-search-index`
- [ ] **5.6** `.github/workflows/ci.yml` — checkout, setup-node, `npm ci`, `npm audit`, lint, build, test
- [ ] **5.7** `.github/workflows/release.yml` — on tag `v*`, build, test, `npm publish --provenance`
- [ ] **5.8** `.github/dependabot.yml` — weekly npm updates
- [ ] **5.9** `LICENSE` — Apache 2.0
- [ ] **5.10** `package-lock.json` — generated by `npm install`, committed

**Output:** `npm ci && npm run build && npm test` succeeds on an empty lib.

---

## Track 6 — Integration Tests (depends on Tracks 1–4)

All code in `test/integ/`. Requires a live Grafana workspace.

- [ ] **6.1** `integ-app.ts` — CDK app with one of each construct targeting a test workspace
- [ ] **6.2** `folder.integ.ts` — deploy, verify folder exists, destroy, verify gone
- [ ] **6.3** `dashboard.integ.ts` — deploy, verify dashboard, update JSON, redeploy, verify version incremented, destroy
- [ ] **6.4** `alert-rule.integ.ts` — deploy, verify rule exists, destroy
- [ ] **6.5** `contact-point.integ.ts` — deploy, verify, destroy
- [ ] **6.6** `datasource.integ.ts` — deploy, verify, destroy
- [ ] **6.7** `notification-policy.integ.ts` — deploy, verify, destroy, verify default policy restored
- [ ] **6.8** Run instructions in README or `test/integ/README.md`

**Output:** Manual run with `GRAFANA_ENDPOINT` and `GRAFANA_TOKEN` env vars passes.

---

## Dependency Graph

```
Track 5 (scaffolding) ─────────────────────────────────┐
                                                        ▼
Track 1 (Lambda handlers) ──▶ Track 3 (Lambda tests) ──┤
                                                        ├──▶ Track 6 (integration)
Track 2 (CDK constructs) ──▶ Track 4 (construct tests) ┤
```

Tracks 1, 2, and 5 can start **immediately in parallel**.
Tracks 3 and 4 start when their upstream completes.
Track 6 starts when all others are done.

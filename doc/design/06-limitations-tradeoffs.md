# 06 — Limitations & Trade-offs

## Known Limitations

### 1. UI edits cause drift

If someone edits a dashboard in the Grafana UI, the state diverges from what CloudFormation expects. On the next stack update, the Custom Resource will overwrite the UI changes with the version from the CDK stack.

**Mitigation:** This is the intended behavior for infrastructure-as-code. Teams that want to allow UI edits can use Grafana's provisioning provenance setting to make code-deployed dashboards read-only in the UI.

### 2. No drift detection

CloudFormation drift detection (`aws cloudformation detect-stack-drift`) does not work with Custom Resources. There is no way to ask CloudFormation "has this Grafana dashboard changed since I deployed it?"

**Mitigation:** None built-in. A separate drift-detection tool (e.g., a scheduled Lambda that compares Grafana state to the dashboard JSON in the repo) could be built, but is out of scope for v1.

### 3. Notification policy is a singleton

Grafana has exactly one notification policy tree per workspace. If multiple stacks deploy `GrafanaNotificationPolicy` targeting the same workspace, they will overwrite each other. The last deployment wins.

**Mitigation:** Document that `GrafanaNotificationPolicy` should only be used from the central Grafana infrastructure stack, not from project stacks. Project stacks should only create contact points and alert rules.

### 4. Dashboard JSON via S3 asset

CloudFormation Custom Resource request payloads are limited to roughly 8KB of custom properties. Large dashboards would exceed this if passed inline.

**Decision:** All dashboard JSON is uploaded as a CDK S3 asset. The Lambda downloads it from S3 at deploy time. CDK's `Asset` construct handles upload, content-hash change detection, and cleanup. This adds an `s3:GetObject` IAM permission to the Lambda and an S3 dependency, but removes all payload size constraints. See [02-custom-resource-provider.md](02-custom-resource-provider.md) for the implementation.

### 5. Lambda cold starts add deploy latency

Each stack deployment invokes the Custom Resource Lambda for each Grafana resource. Lambda cold starts (~1-2s for Node.js) add up.

**Mitigation:** The singleton provider pattern means only one Lambda is created per stack. Subsequent invocations within the same deployment reuse the warm instance. For most stacks (5-20 dashboards), total overhead is negligible.

### 6. Adopting existing resources overwrites them

The Create handler uses `overwrite: true` so that CloudFormation replacements (create-before-delete) and adoption of pre-existing resources work seamlessly. This means that if a dashboard with the same UID already exists — whether created manually or by another stack — it will be **overwritten** on first deploy.

**Mitigation:** This is the safest default for IaC correctness: the CDK stack is the source of truth. Users should verify they are using the correct UID before deploying. The commit message in Grafana's dashboard version history (`Deployed by cdk-grafana-resources`) makes it clear when a dashboard was overwritten by the construct.

### 7. Grafana API version compatibility

The Grafana HTTP API evolves across versions. This library targets:
- **Dashboards API:** stable since Grafana 5.x, unlikely to break
- **Provisioning API (alerts, contact points, notification policies):** introduced in Grafana 9.x, stable since 10.x
- **Folders API:** stable since Grafana 5.x
- **Datasources API:** stable since Grafana 5.x

AWS Managed Grafana currently supports versions 9.4, 10.4. The library should work with both.

**Mitigation:** The construct does not enforce a Grafana version. If an API is unavailable, the Lambda returns a clear error from the Grafana API response.

### 8. VPC-hosted Grafana requires explicit configuration

If the Grafana workspace is reachable only from within a VPC (e.g., private endpoints, IP allowlisting), the provider Lambda must be deployed in that VPC. This is opt-in via `GrafanaProviderProps.vpc`.

**Mitigation:** The `GrafanaProvider` accepts optional `vpc`, `vpcSubnets`, and `securityGroups` props. When a VPC is configured, the Lambda is placed in the specified subnets with outbound internet access (via NAT Gateway or VPC endpoints) to reach both Grafana and Secrets Manager.

### 9. Provider resources retained on stack deletion

The CDK Provider framework creates supporting resources (framework Lambda, log groups) that use the default removal policy (`RETAIN`). After stack deletion, orphaned log groups may accumulate.

**Mitigation:** The provider sets `logRetention` (default: one week) on both the handler Lambda and the framework Lambda, which limits cost. For non-production stacks, consumers can configure shorter retention. Full cleanup of the provider's log groups on stack deletion requires manual intervention or a separate cleanup process — this is a CDK Provider framework limitation, not specific to this library.

### 10. No batch operations

Each Grafana resource is a separate Custom Resource invocation. Deploying 50 dashboards means 50 Lambda invocations. CloudFormation processes Custom Resources sequentially by default, which can make deployments slow for large numbers of resources.

**Mitigation:** CloudFormation may parallelize some Custom Resource operations, but this is not guaranteed. For very large deployments, users can split dashboards across multiple stacks or use the script-based approach as a complement.

## Design Decisions

### Why Custom Resources over AwsCustomResource?

`AwsCustomResource` (from `aws-cdk-lib/custom-resources`) wraps a single AWS SDK call per lifecycle event. It's simpler but:

- Creates a separate Lambda per construct instance
- Cannot call non-AWS APIs (Grafana HTTP API is not an AWS SDK call)
- Limited error handling and retry logic

The shared `Provider` pattern is more work up front but scales better and gives full control over the HTTP interaction.

### Why not a CDK Provider Framework isComplete handler?

The Provider Framework supports an `isComplete` handler for async operations that take time. Grafana API calls are synchronous (the dashboard is created immediately), so `isComplete` is not needed.

### Why user-provided UIDs instead of auto-generated?

Constructs require users to provide a `uid` for each Grafana resource. This is intentional:

- **Deterministic physical resource IDs** — CloudFormation uses the physical resource ID to track the resource. Auto-generated IDs would change if the construct is replaced, causing unnecessary delete+create cycles.
- **Cross-stack references** — a dashboard in one stack can reference a folder UID from another stack without runtime lookups.
- **Readable Grafana URLs** — dashboard URLs include the UID (`/d/my-app-prod/...`), so user-chosen UIDs make URLs meaningful.

### Why clear the token cache on each invocation?

Module-level state in Lambda persists across warm invocations. If we cached the token indefinitely, a rotated (revoked) token would continue to be used until the execution environment is recycled — causing silent auth failures. Clearing the cache on each `onEvent` call ensures the Lambda always reads the current token from Secrets Manager. The cost is one Secrets Manager API call per CloudFormation operation, which is negligible.

### Why validate `grafanaEndpoint` at both synth and deploy time?

Synth-time validation catches misconfigured endpoints before deployment. Deploy-time validation (in the Lambda) is a defense-in-depth measure: if a CloudFormation template is modified after synthesis (e.g., via direct API call or import), the Lambda still rejects invalid endpoints. This prevents the Lambda from being used as an SSRF proxy to send authenticated requests to arbitrary hosts.

### Why Apache 2.0 license?

- Standard for AWS CDK construct libraries (including CDK itself)
- Permissive — allows commercial use without copyleft obligations
- Patent grant — protects contributors and users
- Compatible with most enterprise legal requirements

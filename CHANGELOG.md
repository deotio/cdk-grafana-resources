# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-03-25

### Fixed

- Move `NotificationPolicy` policyJson to S3 asset to avoid CloudFormation property size limits and keep routing rules out of stack state
- Add `safeJsonParse()` with actionable error messages across all Lambda handlers
- Make synth-time validation Token-aware (skip for unresolved CDK Tokens)
- Validate `folderUid` when passed as a plain string in `GrafanaDashboard` and `GrafanaAlertRule`

### Changed

- Deduplicate `GrafanaApiVersion` type to single source in `api-version.ts`
- Include `.d.ts.map` files in published package for IDE "Go to Definition" support
- Add `homepage`, `bugs`, `engines` fields to package.json
- Release workflow uses npm Trusted Publishing (OIDC) instead of long-lived tokens

## [0.1.0] - 2026-03-25

### Added

- `GrafanaFolder` construct for managing Grafana folders
- `GrafanaDashboard` construct with version tracking and S3 asset support
- `GrafanaAlertRule` construct for Grafana-managed alert rules
- `GrafanaContactPoint` construct for alert notification endpoints
- `GrafanaDatasource` construct with `secureJsonData` support via Secrets Manager or S3
- `GrafanaNotificationPolicy` construct for alert routing policy trees
- `GrafanaCloudWatchRole` IAM role helper for cross-account CloudWatch access
- `GrafanaAlertSnsIntegration` high-level construct combining SNS topic, IAM permissions, and Grafana contact point
- Singleton `GrafanaProvider` Lambda per stack with token caching and retry logic
- `grafanaApiVersion` prop (`v10`, `v11`) with centralized API version registry for future Grafana compatibility
- Synth-time and runtime validation of endpoints and UIDs to prevent SSRF and path traversal
- 134 unit tests including cdk-nag compliance and security validation
- CI/CD workflows for PR validation and npm release
- Apache 2.0 license

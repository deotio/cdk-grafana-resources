# cdk-grafana-resources — Design Overview

## Problem

Teams using AWS CDK to manage infrastructure alongside AWS Managed Grafana (or self-hosted Grafana) have no way to manage Grafana-level resources — dashboards, alert rules, folders, contact points, datasources — as part of their CDK stacks. The only mature IaC option is the Terraform Grafana provider. Teams using CDK must either maintain a parallel Terraform setup or write ad-hoc scripts.

## Solution

`cdk-grafana-resources` is a library of AWS CDK L3 constructs that manage Grafana resources via the Grafana HTTP API, using CloudFormation Custom Resources under the hood. Grafana resources participate in the full CloudFormation lifecycle — create, update, delete, and rollback — without requiring any tooling outside of `cdk deploy`.

## Design Principles

1. **CloudFormation-native lifecycle** — Grafana resources are created, updated, and deleted as part of the stack. Rollback works. No post-deploy scripts.
2. **Minimal surface area** — Each construct maps to one Grafana API resource. No magic, no opinions about folder structure or naming conventions.
3. **Secure by default** — The library never stores API tokens in CloudFormation state or logs. Tokens are resolved at deploy time from AWS Secrets Manager.
4. **Idempotent** — Custom Resources use Grafana UIDs to ensure create/update operations are safe to retry.
5. **Testable** — Constructs synthesize to standard CloudFormation templates and can be validated with `aws-cdk-lib/assertions` and `cdk-nag`.

## Architecture

```
Project AWS Account                         Shared AWS Account
┌─────────────────────────┐                ┌──────────────────────┐
│  Project CDK Stack       │                │  Grafana Workspace   │
│                          │                │                      │
│  GrafanaDashboard ──────────── HTTP API ───▶ Dashboard          │
│  GrafanaAlertRule ──────────── HTTP API ───▶ Alert Rule         │
│  GrafanaFolder    ──────────── HTTP API ───▶ Folder             │
│  GrafanaContactPoint ──────── HTTP API ───▶ Contact Point       │
│  GrafanaDatasource ─────────── HTTP API ───▶ Datasource        │
│                          │                │                      │
│  ┌────────────────────┐  │                │                      │
│  │ Shared Lambda      │  │                │                      │
│  │ (Custom Resource   │  │                │                      │
│  │  Provider)         │  │                │                      │
│  └────────────────────┘  │                │                      │
│           │              │                └──────────────────────┘
│           ▼              │
│  Secrets Manager ────────│── cross-account read ──▶ Token Secret
│  (token retrieval)       │
└─────────────────────────┘
```

Key architectural points:

- The CDK stack lives in the **project's own AWS account**
- The Custom Resource Lambda calls the Grafana HTTP API in the **shared account**
- The Grafana API token is stored in Secrets Manager in the shared account, with a cross-account resource policy allowing the project account to read it
- A **single shared Lambda** handles all Grafana resource types within a stack (see [02-custom-resource-provider.md](02-custom-resource-provider.md))

## Constructs

| Construct                   | Grafana API                                    | Priority |
| --------------------------- | ---------------------------------------------- | -------- |
| `GrafanaDashboard`          | `POST/PUT /api/dashboards/db`                  | P0       |
| `GrafanaFolder`             | `POST/PUT /api/folders`                        | P0       |
| `GrafanaAlertRule`          | `POST/PUT /api/v1/provisioning/alert-rules`    | P1       |
| `GrafanaContactPoint`       | `POST/PUT /api/v1/provisioning/contact-points` | P1       |
| `GrafanaDatasource`         | `POST/PUT /api/datasources`                    | P2       |
| `GrafanaNotificationPolicy` | `PUT /api/v1/provisioning/policies`            | P2       |

Priorities reflect typical adoption order. P0 constructs ship in the initial release.

## Usage Example

```typescript
import { GrafanaDashboard, GrafanaFolder } from 'cdk-grafana-resources';

const folder = new GrafanaFolder(this, 'ProdFolder', {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: secretsmanager.Secret.fromSecretCompleteArn(this, 'GrafanaToken', tokenArn),
  uid: 'my-app-prod',
  title: 'My App — Prod',
});

new GrafanaDashboard(this, 'OverviewDashboard', {
  grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
  apiTokenSecret: folder.apiTokenSecret, // reuse
  folderUid: folder.uid,
  dashboardJson: fs.readFileSync('grafana/dashboards/overview.json', 'utf-8'),
});
```

## Design Documents

| #   | Document                                                   | Description                                            |
| --- | ---------------------------------------------------------- | ------------------------------------------------------ |
| 00  | [Overview](00-overview.md)                                 | This document                                          |
| 01  | [Construct API](01-construct-api.md)                       | Props, methods, and outputs for each construct         |
| 02  | [Custom Resource Provider](02-custom-resource-provider.md) | Lambda handler design, shared provider, error handling |
| 03  | [Authentication](03-authentication.md)                     | Token retrieval, cross-account access, rotation        |
| 04  | [Testing Strategy](04-testing-strategy.md)                 | Unit tests, integration tests, example stacks          |
| 05  | [Packaging & Distribution](05-packaging-distribution.md)   | npm publishing, jsii, versioning, repo structure       |
| 06  | [Limitations & Trade-offs](06-limitations-tradeoffs.md)    | Known constraints and design decisions                 |

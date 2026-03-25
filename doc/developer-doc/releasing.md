# Releasing

This project publishes to npm via a GitHub Actions workflow using [npm Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/). No long-lived tokens or secrets are required.

## How to release

1. Bump the `version` in `package.json`
2. Commit the change
3. Tag and push:
   ```bash
   git tag v<version>
   git push origin v<version>
   ```

The `release.yml` workflow triggers on `v*` tags and runs:
- `npm ci`
- `npm audit --audit-level=high`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm publish --provenance --access public`

npm provenance attestations are generated automatically, allowing consumers to verify the package was built from this repository.

## Trusted Publishing setup

Trusted Publishing is already configured for this package. If it ever needs to be reconfigured (e.g., after transferring the repo), follow these steps:

### Prerequisites

- The package must have at least one version published to npm already
- You must be an owner or maintainer of the package on npmjs.com

### Steps

1. **Go to package settings** — Navigate to npmjs.com → click your profile avatar → Packages → click `@deotio/cdk-grafana-resources` → Settings tab
2. **Add GitHub Actions as trusted publisher** — Scroll to the Trusted Publisher section and click GitHub Actions. Fill in:

   | Field | Value |
   |-------|-------|
   | Organization or user | `deotio` |
   | Repository | `cdk-grafana-resources` |
   | Workflow filename | `release.yml` |
   | Environment | *(leave empty)* |

3. Click Save

### How it works

When the workflow runs, GitHub generates a short-lived OIDC token that proves the publish request came from the `deotio/cdk-grafana-resources` repository's `release.yml` workflow. npm verifies this token and authorizes the publish without any stored secrets. The token cannot be exfiltrated or reused.

# 05 — Packaging & Distribution

## Repository Structure

```
cdk-grafana-resources/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Lint, test, cdk-nag on every PR
│       └── release.yml         # Publish to npm on version tag
├── .projenrc.ts                # projen project configuration (optional)
├── doc/
│   └── design/                 # This design documentation
├── lambda/
│   └── grafana-provider/
│       ├── index.ts
│       ├── handlers/
│       │   ├── folder.ts
│       │   ├── dashboard.ts
│       │   ├── alert-rule.ts
│       │   ├── contact-point.ts
│       │   ├── datasource.ts
│       │   └── notification-policy.ts
│       ├── grafana-client.ts
│       ├── s3-asset.ts
│       └── token.ts
├── lib/
│   ├── index.ts                # Public API barrel export
│   ├── grafana-provider.ts     # Singleton provider construct
│   ├── grafana-folder.ts
│   ├── grafana-dashboard.ts
│   ├── grafana-alert-rule.ts
│   ├── grafana-contact-point.ts
│   ├── grafana-datasource.ts
│   └── grafana-notification-policy.ts
├── test/
│   ├── grafana-folder.test.ts
│   ├── grafana-dashboard.test.ts
│   ├── grafana-alert-rule.test.ts
│   ├── grafana-contact-point.test.ts
│   ├── grafana-datasource.test.ts
│   ├── grafana-notification-policy.test.ts
│   ├── grafana-provider.test.ts
│   ├── lambda/
│   │   ├── dashboard-handler.test.ts
│   │   ├── folder-handler.test.ts
│   │   └── ...
│   └── integ/                  # Integration tests (not run in CI)
│       ├── integ-app.ts
│       └── dashboard.integ.ts
├── package.json
├── package-lock.json           # Committed — reproducible builds
├── tsconfig.json
├── tsconfig.dev.json
├── .eslintrc.json
├── .prettierrc
├── LICENSE                     # Apache 2.0
└── .gitignore
```

## npm Package

### Package name

```
cdk-grafana-resources
```

On npm: `npm install cdk-grafana-resources`

### package.json (key fields)

```json
{
  "name": "cdk-grafana-resources",
  "version": "0.1.0",
  "description": "AWS CDK constructs for managing Grafana dashboards, alerts, and other resources via the HTTP API",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": [
    "lib/**/*.js",
    "lib/**/*.d.ts",
    "lambda/**/*.ts"
  ],
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint 'lib/**/*.ts' 'lambda/**/*.ts' 'test/**/*.ts'",
    "prepublishOnly": "npm run build && npm run test"
  },
  "peerDependencies": {
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.0.0"
  },
  "devDependencies": {
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "esbuild": "^0.20.0",
    "cdk-nag": "^2.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "@types/aws-lambda": "^8.10.0"
  },
  "keywords": [
    "aws",
    "cdk",
    "grafana",
    "dashboard",
    "alerting",
    "observability",
    "infrastructure-as-code"
  ],
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/deotio/cdk-grafana-resources.git"
  }
}
```

### Peer dependencies

`aws-cdk-lib` and `constructs` are **peer dependencies** — they must not be bundled. This ensures consumers use a single version of CDK in their project.

### What ships in the package

- `lib/` — compiled construct code (`.js` + `.d.ts`)
- `lambda/` — TypeScript source for the Lambda handler

The Lambda is bundled automatically at synth time by `NodejsFunction` using esbuild. No pre-build step is needed for the Lambda code — consumers only need `npm run build` for the construct library itself.

## jsii — Multi-Language Support

CDK construct libraries that want to support Python, Java, .NET, and Go use [jsii](https://github.com/aws/jsii) to compile TypeScript into those languages.

**Decision: Start TypeScript-only. Add jsii later if there's demand.**

Rationale:
- jsii imposes constraints on the TypeScript code (no enums, no generics in public API, specific module structure)
- Adding jsii later is straightforward — the public API is simple (construct props + construct class)
- The primary audience (CDK users managing Grafana on AWS) overwhelmingly uses TypeScript

If jsii is added later, the package would be published as:
- npm: `cdk-grafana-resources`
- PyPI: `cdk-grafana-resources`
- Maven: `io.github.deotio/cdk-grafana-resources`
- NuGet: `CdkGrafanaResources`

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **0.x.y** — initial development. Breaking changes allowed in minor versions.
- **1.0.0** — stable public API. Breaking changes only in major versions.

The transition from 0.x to 1.0 happens when:
1. All P0 and P1 constructs are implemented and tested
2. At least one production consumer (e.g., `dot-grafana` project repos) has used it successfully
3. The construct API has been stable for at least two minor releases

## CI/CD

### PR Validation (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

### Release (`.github/workflows/release.yml`)

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Release process

1. Update version in `package.json`
2. Commit: `git commit -m "release: v0.1.0"`
3. Tag: `git tag v0.1.0`
4. Push: `git push && git push --tags`
5. GitHub Actions publishes to npm

## Supply Chain Security

- **`package-lock.json` committed** — ensures `npm ci` installs exact dependency versions for reproducible builds. Prevents transitive dependency attacks.
- **`npm audit` in CI** — fails the build on high-severity vulnerabilities in dependencies.
- **npm provenance** — release workflow uses `--provenance` (SLSA Build L3) so consumers can verify the package was built from this repo by GitHub Actions.
- **Dependabot** — configure `.github/dependabot.yml` for automated dependency update PRs:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
```

- **Minimal runtime dependencies** — the Lambda has zero npm runtime dependencies. It uses native `fetch` (Node.js 22) and `@aws-sdk/*` from the Lambda runtime. This eliminates supply chain risk for the deployed code.

## License

**Apache 2.0** — standard for CDK construct libraries. Allows commercial use, permits modification and distribution, and provides patent protection.

## Construct Hub

After publishing to npm, the package will automatically appear on [Construct Hub](https://constructs.dev/) — the central registry for CDK constructs. Construct Hub indexes all npm packages that depend on `constructs` as a peer dependency.

To improve discoverability, the package should include:
- `keywords` in `package.json` (already included above)
- A well-structured README with usage examples
- Proper `jsii` metadata (if/when jsii is added)

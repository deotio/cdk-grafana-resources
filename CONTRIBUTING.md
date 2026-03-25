# Contributing

Thanks for your interest in contributing to `cdk-grafana-resources`.

## Development setup

```bash
git clone https://github.com/deotio/cdk-grafana-resources.git
cd cdk-grafana-resources
npm install
```

## Commands

```bash
npm run build    # TypeScript compilation (output in dist/)
npm test         # Run all tests (134 tests, 90% coverage threshold)
npm run lint     # ESLint
```

## Making changes

1. Create a branch from `master`
2. Make your changes
3. Run `npm run build && npm test && npm run lint` — all must pass
4. Open a pull request against `master`

CI runs automatically on PRs and requires the `test` job to pass before merge.

## Project structure

```
lib/                          # CDK construct source (TypeScript)
lambda/grafana-provider/      # Custom Resource Lambda handler
  api-version.ts              # Grafana API version registry
  handlers/                   # Per-resource-type handlers
test/                         # Jest tests
  lambda/                     # Handler unit tests
dist/                         # Compiled output (gitignored)
doc/
  design/                     # Architecture and design docs
  developer-doc/              # Developer guides (releasing, etc.)
  user-doc/                   # End-user documentation
```

## Adding a new Grafana resource type

1. Add a resource profile in `lambda/grafana-provider/api-version.ts`
2. Create a handler in `lambda/grafana-provider/handlers/`
3. Export the handler from `lambda/grafana-provider/handlers/index.ts`
4. Register the handler in `lambda/grafana-provider/index.ts`
5. Create a CDK construct in `lib/`
6. Export from `lib/index.ts`
7. Add tests in both `test/` and `test/lambda/`

## Adding support for a new Grafana API version

1. Add the version to the `GrafanaApiVersion` type in `lambda/grafana-provider/api-version.ts`
2. Create a new profile that spreads from the previous version and overrides changed resources
3. Add it to the `profiles` record

No handler code needs to change.

## Code style

- TypeScript strict mode
- ESLint + Prettier
- No unnecessary comments or docstrings on code you didn't change
- Use `safeJsonParse()` from `lambda/grafana-provider/json-parse.ts` instead of bare `JSON.parse`

## Releasing

See [doc/developer-doc/releasing.md](doc/developer-doc/releasing.md).

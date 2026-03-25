# Grafana API versioning

The library uses a centralized API version registry. All Grafana API paths, request shapes, and response parsers are defined per version in a single file (`lambda/grafana-provider/api-version.ts`).

Set `grafanaApiVersion` on any construct to target a specific Grafana version:

```typescript
new GrafanaFolder(this, 'Folder', {
  grafanaApiVersion: 'v11',
  // ...
});
```

To add support for a new Grafana version, create a new profile in the registry that inherits from the previous version and overrides only what changed. No handler code needs to change.

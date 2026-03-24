/**
 * Grafana API version registry.
 *
 * Centralizes all Grafana API paths, request body builders, and response
 * parsers so that supporting a new Grafana version requires changes in
 * ONE file rather than across every handler.
 *
 * Each version profile maps resource types to their API operations.
 * Handlers call `getApiProfile(version)` and use the returned profile
 * instead of hardcoding paths and shapes.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Supported Grafana API version identifiers. */
export type GrafanaApiVersion = 'v10' | 'v11';

/** The default API version when none is specified. */
export const DEFAULT_API_VERSION: GrafanaApiVersion = 'v10';

/** A single API operation (method + path builder). */
export interface ApiRoute {
  method: string;
  path: (baseUrl: string, uid?: string) => string;
}

/** Headers that should be added to every request for a resource type. */
export interface ResourceProfile {
  /** Extra headers (e.g., X-Disable-Provenance). */
  extraHeaders?: Record<string, string>;
  /** Per-action routes. */
  routes: {
    create: ApiRoute;
    /** Some resources use the same route for create and update (dashboard). */
    update: ApiRoute;
    delete: ApiRoute;
  };
  /** Build the request body for create/update. */
  buildBody: (props: Record<string, unknown>) => unknown;
  /** Parse the API response into CloudFormation return data. */
  parseResponse: (result: Record<string, unknown>) => Record<string, string>;
  /** Body sent on Delete to "reset" the resource (notification-policy only). */
  deleteBody?: unknown;
}

export interface ApiProfile {
  folder: ResourceProfile;
  dashboard: ResourceProfile;
  alertRule: ResourceProfile;
  contactPoint: ResourceProfile;
  datasource: ResourceProfile;
  notificationPolicy: ResourceProfile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enc(uid?: string): string {
  return encodeURIComponent(uid ?? '');
}

// ---------------------------------------------------------------------------
// Default notification policy — externalised so it can be overridden by
// callers or updated per-version.
// ---------------------------------------------------------------------------

export const GRAFANA_DEFAULT_NOTIFICATION_POLICY = {
  receiver: 'grafana-default-email',
  group_by: ['grafana_folder', 'alertname'],
  routes: [],
  group_wait: '30s',
  group_interval: '5m',
  repeat_interval: '4h',
};

// ---------------------------------------------------------------------------
// v10 profile (also covers Amazon Managed Grafana as of 2025)
// ---------------------------------------------------------------------------

const v10Profile: ApiProfile = {
  folder: {
    routes: {
      create: { method: 'POST', path: (b) => `${b}/api/folders` },
      update: { method: 'PUT', path: (b, uid) => `${b}/api/folders/${enc(uid)}` },
      delete: { method: 'DELETE', path: (b, uid) => `${b}/api/folders/${enc(uid)}` },
    },
    buildBody: (p) => ({ uid: p.uid, title: p.title, overwrite: true }),
    parseResponse: (r) => ({ FolderId: String(r.id) }),
  },

  dashboard: {
    routes: {
      create: { method: 'POST', path: (b) => `${b}/api/dashboards/db` },
      update: { method: 'POST', path: (b) => `${b}/api/dashboards/db` },
      delete: { method: 'DELETE', path: (b, uid) => `${b}/api/dashboards/uid/${enc(uid)}` },
    },
    buildBody: (p) => ({
      dashboard: p.dashboard,
      folderUid: p.folderUid,
      overwrite: true,
      message: p.message || 'Deployed by cdk-grafana-resources',
    }),
    parseResponse: (r) => ({
      DashboardId: String(r.id),
      Url: String(r.url),
      Version: String(r.version),
    }),
  },

  alertRule: {
    extraHeaders: { 'X-Disable-Provenance': 'true' },
    routes: {
      create: { method: 'POST', path: (b) => `${b}/api/v1/provisioning/alert-rules` },
      update: { method: 'PUT', path: (b, uid) => `${b}/api/v1/provisioning/alert-rules/${enc(uid)}` },
      delete: { method: 'DELETE', path: (b, uid) => `${b}/api/v1/provisioning/alert-rules/${enc(uid)}` },
    },
    buildBody: (p) => p.rule,
    parseResponse: () => ({}),
  },

  contactPoint: {
    extraHeaders: { 'X-Disable-Provenance': 'true' },
    routes: {
      create: { method: 'POST', path: (b) => `${b}/api/v1/provisioning/contact-points` },
      update: { method: 'PUT', path: (b, uid) => `${b}/api/v1/provisioning/contact-points/${enc(uid)}` },
      delete: { method: 'DELETE', path: (b, uid) => `${b}/api/v1/provisioning/contact-points/${enc(uid)}` },
    },
    buildBody: (p) => ({ uid: p.uid, name: p.name, type: p.type, settings: p.settings }),
    parseResponse: () => ({}),
  },

  datasource: {
    routes: {
      create: { method: 'POST', path: (b) => `${b}/api/datasources` },
      update: { method: 'PUT', path: (b, uid) => `${b}/api/datasources/uid/${enc(uid)}` },
      delete: { method: 'DELETE', path: (b, uid) => `${b}/api/datasources/uid/${enc(uid)}` },
    },
    buildBody: (p) => p.body,
    parseResponse: (r) => ({ DatasourceId: String(r.id) }),
  },

  notificationPolicy: {
    extraHeaders: { 'X-Disable-Provenance': 'true' },
    routes: {
      create: { method: 'PUT', path: (b) => `${b}/api/v1/provisioning/policies` },
      update: { method: 'PUT', path: (b) => `${b}/api/v1/provisioning/policies` },
      delete: { method: 'PUT', path: (b) => `${b}/api/v1/provisioning/policies` },
    },
    buildBody: (p) => p.policy,
    parseResponse: () => ({}),
    deleteBody: GRAFANA_DEFAULT_NOTIFICATION_POLICY,
  },
};

// ---------------------------------------------------------------------------
// v11 profile — inherits from v10, override only what changes.
//
// When Grafana 11 introduces breaking API changes, override the affected
// resource profiles here. For now v11 is identical to v10.
// ---------------------------------------------------------------------------

const v11Profile: ApiProfile = {
  ...v10Profile,
  // Example of a future override:
  // folder: {
  //   ...v10Profile.folder,
  //   routes: {
  //     ...v10Profile.folder.routes,
  //     create: { method: 'POST', path: (b) => `${b}/api/v2/folders` },
  //   },
  // },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const profiles: Record<GrafanaApiVersion, ApiProfile> = {
  v10: v10Profile,
  v11: v11Profile,
};

/**
 * Returns the API profile for the given Grafana version.
 * Throws if the version is not supported.
 */
export function getApiProfile(version?: string): ApiProfile {
  const v = (version ?? DEFAULT_API_VERSION) as GrafanaApiVersion;
  const profile = profiles[v];
  if (!profile) {
    throw new Error(
      `Unsupported grafanaApiVersion: '${v}'. Supported versions: ${Object.keys(profiles).join(', ')}`,
    );
  }
  return profile;
}

/** Returns the list of supported API version identifiers. */
export function getSupportedVersions(): GrafanaApiVersion[] {
  return Object.keys(profiles) as GrafanaApiVersion[];
}

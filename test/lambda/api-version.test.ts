import {
  getApiProfile,
  getSupportedVersions,
  DEFAULT_API_VERSION,
  GRAFANA_DEFAULT_NOTIFICATION_POLICY,
} from '../../lambda/grafana-provider/api-version';

describe('api-version registry', () => {
  test('DEFAULT_API_VERSION is v10', () => {
    expect(DEFAULT_API_VERSION).toBe('v10');
  });

  test('getSupportedVersions returns v10 and v11', () => {
    const versions = getSupportedVersions();
    expect(versions).toContain('v10');
    expect(versions).toContain('v11');
  });

  test('getApiProfile returns profile for v10', () => {
    const profile = getApiProfile('v10');
    expect(profile).toHaveProperty('folder');
    expect(profile).toHaveProperty('dashboard');
    expect(profile).toHaveProperty('alertRule');
    expect(profile).toHaveProperty('contactPoint');
    expect(profile).toHaveProperty('datasource');
    expect(profile).toHaveProperty('notificationPolicy');
  });

  test('getApiProfile returns profile for v11', () => {
    const profile = getApiProfile('v11');
    expect(profile).toHaveProperty('folder');
  });

  test('getApiProfile defaults to v10 when undefined', () => {
    const profile = getApiProfile(undefined);
    const v10 = getApiProfile('v10');
    expect(profile).toEqual(v10);
  });

  test('getApiProfile throws on unsupported version', () => {
    expect(() => getApiProfile('v99')).toThrow('Unsupported grafanaApiVersion');
  });

  describe('v10 folder routes', () => {
    const folder = getApiProfile('v10').folder;

    test('create route builds correct path', () => {
      expect(folder.routes.create.method).toBe('POST');
      expect(folder.routes.create.path('https://g.example.com')).toBe(
        'https://g.example.com/api/folders',
      );
    });

    test('update route builds correct path with uid', () => {
      expect(folder.routes.update.method).toBe('PUT');
      expect(folder.routes.update.path('https://g.example.com', 'my-folder')).toBe(
        'https://g.example.com/api/folders/my-folder',
      );
    });

    test('delete route builds correct path with uid', () => {
      expect(folder.routes.delete.method).toBe('DELETE');
      expect(folder.routes.delete.path('https://g.example.com', 'my-folder')).toBe(
        'https://g.example.com/api/folders/my-folder',
      );
    });

    test('encodes UID in path', () => {
      expect(folder.routes.update.path('https://g.example.com', 'a/b')).toBe(
        'https://g.example.com/api/folders/a%2Fb',
      );
    });

    test('buildBody returns uid, title, overwrite', () => {
      const body = folder.buildBody({ uid: 'f1', title: 'Test' });
      expect(body).toEqual({ uid: 'f1', title: 'Test', overwrite: true });
    });

    test('parseResponse extracts FolderId', () => {
      expect(folder.parseResponse({ id: 42 })).toEqual({ FolderId: '42' });
    });
  });

  describe('v10 dashboard routes', () => {
    const dashboard = getApiProfile('v10').dashboard;

    test('create and update use same POST path', () => {
      expect(dashboard.routes.create.path('https://g.example.com')).toBe(
        'https://g.example.com/api/dashboards/db',
      );
      expect(dashboard.routes.update.path('https://g.example.com')).toBe(
        'https://g.example.com/api/dashboards/db',
      );
    });

    test('delete uses uid path', () => {
      expect(dashboard.routes.delete.path('https://g.example.com', 'd1')).toBe(
        'https://g.example.com/api/dashboards/uid/d1',
      );
    });

    test('parseResponse extracts DashboardId, Url, Version', () => {
      expect(dashboard.parseResponse({ id: 5, url: '/d/x/y', version: 3 })).toEqual({
        DashboardId: '5',
        Url: '/d/x/y',
        Version: '3',
      });
    });
  });

  describe('v10 alertRule routes', () => {
    const alertRule = getApiProfile('v10').alertRule;

    test('uses provisioning API paths', () => {
      expect(alertRule.routes.create.path('https://g.example.com')).toContain(
        '/api/v1/provisioning/alert-rules',
      );
    });

    test('has X-Disable-Provenance header', () => {
      expect(alertRule.extraHeaders).toEqual({ 'X-Disable-Provenance': 'true' });
    });
  });

  describe('v10 notificationPolicy', () => {
    const np = getApiProfile('v10').notificationPolicy;

    test('deleteBody is the default notification policy', () => {
      expect(np.deleteBody).toEqual(GRAFANA_DEFAULT_NOTIFICATION_POLICY);
    });

    test('default policy has expected shape', () => {
      expect(GRAFANA_DEFAULT_NOTIFICATION_POLICY).toEqual({
        receiver: 'grafana-default-email',
        group_by: ['grafana_folder', 'alertname'],
        routes: [],
        group_wait: '30s',
        group_interval: '5m',
        repeat_interval: '4h',
      });
    });

    test('buildBody passes through policy', () => {
      const policy = { receiver: 'test' };
      expect(np.buildBody({ policy })).toBe(policy);
    });

    test('parseResponse returns empty object', () => {
      expect(np.parseResponse({ anything: 'ignored' })).toEqual({});
    });
  });

  describe('v10 contactPoint profile', () => {
    const cp = getApiProfile('v10').contactPoint;

    test('buildBody assembles uid, name, type, settings', () => {
      const body = cp.buildBody({ uid: 'cp1', name: 'Test', type: 'slack', settings: { url: 'https://hooks.slack.com' } });
      expect(body).toEqual({ uid: 'cp1', name: 'Test', type: 'slack', settings: { url: 'https://hooks.slack.com' } });
    });

    test('parseResponse returns empty object', () => {
      expect(cp.parseResponse({})).toEqual({});
    });

    test('routes encode uid in paths', () => {
      expect(cp.routes.update.path('https://g.example.com', 'a/b')).toBe(
        'https://g.example.com/api/v1/provisioning/contact-points/a%2Fb',
      );
    });
  });

  describe('v10 alertRule profile', () => {
    const ar = getApiProfile('v10').alertRule;

    test('buildBody passes through rule', () => {
      const rule = { uid: 'r1', condition: 'A' };
      expect(ar.buildBody({ rule })).toBe(rule);
    });

    test('parseResponse returns empty object', () => {
      expect(ar.parseResponse({})).toEqual({});
    });
  });

  describe('v10 datasource profile', () => {
    const ds = getApiProfile('v10').datasource;

    test('buildBody passes through body', () => {
      const body = { uid: 'ds1', name: 'Test' };
      expect(ds.buildBody({ body })).toBe(body);
    });

    test('parseResponse extracts DatasourceId', () => {
      expect(ds.parseResponse({ id: 7 })).toEqual({ DatasourceId: '7' });
    });
  });
});

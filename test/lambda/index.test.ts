jest.mock('../../lambda/grafana-provider/token');
jest.mock('../../lambda/grafana-provider/handlers', () => ({
  handleFolder: jest.fn().mockResolvedValue({ PhysicalResourceId: 'folder-uid' }),
  handleDashboard: jest.fn().mockResolvedValue({ PhysicalResourceId: 'dash-uid' }),
  handleAlertRule: jest.fn().mockResolvedValue({ PhysicalResourceId: 'rule-uid' }),
  handleContactPoint: jest.fn().mockResolvedValue({ PhysicalResourceId: 'cp-uid' }),
  handleDatasource: jest.fn().mockResolvedValue({ PhysicalResourceId: 'ds-uid' }),
  handleNotificationPolicy: jest.fn().mockResolvedValue({ PhysicalResourceId: 'notification-policy' }),
}));

import { onEvent } from '../../lambda/grafana-provider/index';
import { getToken, clearTokenCache } from '../../lambda/grafana-provider/token';
import {
  handleFolder,
  handleDashboard,
  handleAlertRule,
  handleContactPoint,
  handleDatasource,
  handleNotificationPolicy,
} from '../../lambda/grafana-provider/handlers';

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockClearTokenCache = clearTokenCache as jest.MockedFunction<typeof clearTokenCache>;

function makeEvent(overrides: Record<string, any> = {}): any {
  return {
    RequestType: 'Create',
    ResourceProperties: {
      ServiceToken: 'arn:aws:lambda:us-east-1:123:function:test',
      GrafanaResourceType: 'Folder',
      GrafanaEndpoint: 'grafana.example.com',
      SecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:test',
      Uid: 'test-uid',
      Title: 'Test',
      ...overrides,
    },
    ...({} as any),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetToken.mockResolvedValue('my-token');
});

describe('onEvent', () => {
  test('clears token cache on each call', async () => {
    await onEvent(makeEvent());
    expect(mockClearTokenCache).toHaveBeenCalled();
  });

  test('invalid endpoint rejected (contains /)', async () => {
    await expect(
      onEvent(makeEvent({ GrafanaEndpoint: 'grafana.example.com/api' })),
    ).rejects.toThrow('Invalid GrafanaEndpoint');
  });

  test('invalid endpoint rejected (contains ?)', async () => {
    await expect(
      onEvent(makeEvent({ GrafanaEndpoint: 'grafana.example.com?foo=bar' })),
    ).rejects.toThrow('Invalid GrafanaEndpoint');
  });

  test('missing required props rejected (no GrafanaEndpoint)', async () => {
    await expect(
      onEvent(makeEvent({ GrafanaEndpoint: '' })),
    ).rejects.toThrow('Missing required properties');
  });

  test('missing required props rejected (no SecretArn)', async () => {
    await expect(
      onEvent(makeEvent({ SecretArn: '' })),
    ).rejects.toThrow('Missing required properties');
  });

  test('unknown resource type rejected', async () => {
    await expect(
      onEvent(makeEvent({ GrafanaResourceType: 'UnknownThing' })),
    ).rejects.toThrow('Unknown or missing GrafanaResourceType');
  });

  test('unsupported API version rejected', async () => {
    await expect(
      onEvent(makeEvent({ GrafanaApiVersion: 'v99' })),
    ).rejects.toThrow('Unsupported grafanaApiVersion');
  });

  test('routes to handleFolder with profile', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'Folder' }));
    expect(handleFolder).toHaveBeenCalledWith(
      'Create',
      'https://grafana.example.com',
      'my-token',
      expect.any(Object),
      expect.objectContaining({ routes: expect.any(Object) }),
    );
  });

  test('routes to handleDashboard', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'Dashboard' }));
    expect(handleDashboard).toHaveBeenCalled();
  });

  test('routes to handleAlertRule', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'AlertRule' }));
    expect(handleAlertRule).toHaveBeenCalled();
  });

  test('routes to handleContactPoint', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'ContactPoint' }));
    expect(handleContactPoint).toHaveBeenCalled();
  });

  test('routes to handleDatasource', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'Datasource' }));
    expect(handleDatasource).toHaveBeenCalled();
  });

  test('routes to handleNotificationPolicy', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'NotificationPolicy' }));
    expect(handleNotificationPolicy).toHaveBeenCalled();
  });

  test('defaults to v10 when GrafanaApiVersion is not set', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'Folder' }));
    // Should not throw — v10 is the default
    expect(handleFolder).toHaveBeenCalled();
  });

  test('accepts v11 as a valid API version', async () => {
    await onEvent(makeEvent({ GrafanaResourceType: 'Folder', GrafanaApiVersion: 'v11' }));
    expect(handleFolder).toHaveBeenCalled();
  });
});

jest.mock('../../lambda/grafana-provider/grafana-client');
jest.mock('../../lambda/grafana-provider/s3-asset');

import { handleNotificationPolicy } from '../../lambda/grafana-provider/handlers/notification-policy';
import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';
import { downloadAsset } from '../../lambda/grafana-provider/s3-asset';
import { getApiProfile, GRAFANA_DEFAULT_NOTIFICATION_POLICY } from '../../lambda/grafana-provider/api-version';

const mockGrafanaFetch = grafanaFetch as jest.MockedFunction<typeof grafanaFetch>;
const mockDownloadAsset = downloadAsset as jest.MockedFunction<typeof downloadAsset>;

const BASE_URL = 'https://grafana.example.com';
const TOKEN = 'test-token';
const POLICY = { receiver: 'my-receiver', group_by: ['alertname'], routes: [] };
const PROPS = {
  PolicyAssetBucket: 'my-bucket',
  PolicyAssetKey: 'policy.json',
} as any;
const profile = getApiProfile('v10').notificationPolicy;

beforeEach(() => {
  mockGrafanaFetch.mockReset();
  mockDownloadAsset.mockReset();
  mockDownloadAsset.mockResolvedValue(JSON.stringify(POLICY));
});

describe('handleNotificationPolicy', () => {
  test('Create downloads policy from S3 and sends PUT', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleNotificationPolicy('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).toHaveBeenCalledWith('my-bucket', 'policy.json');
    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/policies`,
      expect.objectContaining({ method: 'PUT' }),
    );
    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body.receiver).toBe('my-receiver');
    expect(result.PhysicalResourceId).toBe('notification-policy');
  });

  test('Update downloads policy from S3 and sends PUT', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleNotificationPolicy('Update', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).toHaveBeenCalled();
    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/policies`,
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(result.PhysicalResourceId).toBe('notification-policy');
  });

  test('Delete sends PUT with default policy from profile, does NOT download S3', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleNotificationPolicy('Delete', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).not.toHaveBeenCalled();
    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body).toEqual(GRAFANA_DEFAULT_NOTIFICATION_POLICY);
    expect(body.receiver).toBe('grafana-default-email');
    expect(body.routes).toEqual([]);
    expect(result.PhysicalResourceId).toBe('notification-policy');
  });

  test('PhysicalResourceId is always notification-policy', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    for (const action of ['Create', 'Update', 'Delete']) {
      const result = await handleNotificationPolicy(action, BASE_URL, TOKEN, PROPS, profile);
      expect(result.PhysicalResourceId).toBe('notification-policy');
    }
  });

  test('X-Disable-Provenance header present', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleNotificationPolicy('Create', BASE_URL, TOKEN, PROPS, profile);

    const headers = mockGrafanaFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Disable-Provenance']).toBe('true');
  });
});

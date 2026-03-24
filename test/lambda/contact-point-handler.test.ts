jest.mock('../../lambda/grafana-provider/grafana-client');
jest.mock('../../lambda/grafana-provider/s3-asset');

import { handleContactPoint } from '../../lambda/grafana-provider/handlers/contact-point';
import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';
import { downloadAsset } from '../../lambda/grafana-provider/s3-asset';
import { getApiProfile } from '../../lambda/grafana-provider/api-version';

const mockGrafanaFetch = grafanaFetch as jest.MockedFunction<typeof grafanaFetch>;
const mockDownloadAsset = downloadAsset as jest.MockedFunction<typeof downloadAsset>;

const BASE_URL = 'https://grafana.example.com';
const TOKEN = 'test-token';
const PROPS = {
  Uid: 'cp-uid',
  SettingsAssetBucket: 'my-bucket',
  SettingsAssetKey: 'settings.json',
  Name: 'My Contact Point',
  Type: 'slack',
} as any;
const profile = getApiProfile('v10').contactPoint;

beforeEach(() => {
  mockGrafanaFetch.mockReset();
  mockDownloadAsset.mockReset();
  mockDownloadAsset.mockResolvedValue(JSON.stringify({ url: 'https://hooks.slack.com/test' }));
});

describe('handleContactPoint', () => {
  test('Create sends POST', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleContactPoint('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/contact-points`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.PhysicalResourceId).toBe('cp-uid');
  });

  test('Create with 409 falls back to PUT', async () => {
    mockGrafanaFetch
      .mockRejectedValueOnce(new Error('Grafana API 409: conflict'))
      .mockResolvedValueOnce({});

    const result = await handleContactPoint('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledTimes(2);
    expect(mockGrafanaFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockGrafanaFetch.mock.calls[1][1].method).toBe('PUT');
    expect(result.PhysicalResourceId).toBe('cp-uid');
  });

  test('Update sends PUT', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleContactPoint('Update', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/contact-points/cp-uid`,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('Delete sends DELETE', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleContactPoint('Delete', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/contact-points/cp-uid`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('X-Disable-Provenance header present in all requests', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleContactPoint('Create', BASE_URL, TOKEN, PROPS, profile);
    const headers = mockGrafanaFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Disable-Provenance']).toBe('true');
  });

  test('downloads settings from S3', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleContactPoint('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).toHaveBeenCalledWith('my-bucket', 'settings.json');
  });

  test('S3 settings are included in the request body', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleContactPoint('Create', BASE_URL, TOKEN, PROPS, profile);

    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body.settings).toEqual({ url: 'https://hooks.slack.com/test' });
    expect(body.uid).toBe('cp-uid');
    expect(body.name).toBe('My Contact Point');
    expect(body.type).toBe('slack');
  });
});

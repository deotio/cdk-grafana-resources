jest.mock('../../lambda/grafana-provider/grafana-client');
jest.mock('../../lambda/grafana-provider/s3-asset');

import { handleAlertRule } from '../../lambda/grafana-provider/handlers/alert-rule';
import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';
import { downloadAsset } from '../../lambda/grafana-provider/s3-asset';
import { getApiProfile } from '../../lambda/grafana-provider/api-version';

const mockGrafanaFetch = grafanaFetch as jest.MockedFunction<typeof grafanaFetch>;
const mockDownloadAsset = downloadAsset as jest.MockedFunction<typeof downloadAsset>;

const BASE_URL = 'https://grafana.example.com';
const TOKEN = 'test-token';
const PROPS = {
  Uid: 'rule-uid',
  RuleAssetBucket: 'my-bucket',
  RuleAssetKey: 'rule.json',
  FolderUid: 'folder-uid',
  RuleGroup: 'my-group',
} as any;
const profile = getApiProfile('v10').alertRule;

beforeEach(() => {
  mockGrafanaFetch.mockReset();
  mockDownloadAsset.mockReset();
  mockDownloadAsset.mockResolvedValue(JSON.stringify({ condition: 'A' }));
});

describe('handleAlertRule', () => {
  test('Create sends POST, returns uid', async () => {
    mockGrafanaFetch.mockResolvedValue({ uid: 'rule-uid' });

    const result = await handleAlertRule('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/alert-rules`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.PhysicalResourceId).toBe('rule-uid');
  });

  test('Create with 409 falls back to PUT', async () => {
    mockGrafanaFetch
      .mockRejectedValueOnce(new Error('Grafana API 409: conflict'))
      .mockResolvedValueOnce({});

    const result = await handleAlertRule('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledTimes(2);
    expect(mockGrafanaFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockGrafanaFetch.mock.calls[1][1].method).toBe('PUT');
    expect(mockGrafanaFetch.mock.calls[1][0]).toContain('/alert-rules/rule-uid');
    expect(result.PhysicalResourceId).toBe('rule-uid');
  });

  test('Update sends PUT', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleAlertRule('Update', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/alert-rules/rule-uid`,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('Delete sends DELETE', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleAlertRule('Delete', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/provisioning/alert-rules/rule-uid`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('X-Disable-Provenance header present in all requests', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    // Test Create
    await handleAlertRule('Create', BASE_URL, TOKEN, PROPS, profile);
    const createHeaders = mockGrafanaFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(createHeaders['X-Disable-Provenance']).toBe('true');

    mockGrafanaFetch.mockClear();

    // Test Update
    await handleAlertRule('Update', BASE_URL, TOKEN, PROPS, profile);
    const updateHeaders = mockGrafanaFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(updateHeaders['X-Disable-Provenance']).toBe('true');

    mockGrafanaFetch.mockClear();

    // Test Delete
    await handleAlertRule('Delete', BASE_URL, TOKEN, PROPS, profile);
    const deleteHeaders = mockGrafanaFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(deleteHeaders['X-Disable-Provenance']).toBe('true');
  });

  test('downloads rule from S3', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    await handleAlertRule('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).toHaveBeenCalledWith('my-bucket', 'rule.json');
  });
});

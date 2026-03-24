jest.mock('../../lambda/grafana-provider/grafana-client');
jest.mock('../../lambda/grafana-provider/s3-asset');

import { handleDashboard } from '../../lambda/grafana-provider/handlers/dashboard';
import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';
import { downloadAsset } from '../../lambda/grafana-provider/s3-asset';
import { getApiProfile } from '../../lambda/grafana-provider/api-version';

const mockGrafanaFetch = grafanaFetch as jest.MockedFunction<typeof grafanaFetch>;
const mockDownloadAsset = downloadAsset as jest.MockedFunction<typeof downloadAsset>;

const BASE_URL = 'https://grafana.example.com';
const TOKEN = 'test-token';
const PROPS = {
  Uid: 'dash-uid',
  DashboardAssetBucket: 'my-bucket',
  DashboardAssetKey: 'dashboard.json',
  FolderUid: 'folder-uid',
} as any;
const profile = getApiProfile('v10').dashboard;

beforeEach(() => {
  mockGrafanaFetch.mockReset();
  mockDownloadAsset.mockReset();
});

describe('handleDashboard', () => {
  test('Create downloads from S3, sets uid and id=null, sends POST with overwrite=true', async () => {
    mockDownloadAsset.mockResolvedValue(JSON.stringify({ title: 'Test Dashboard' }));
    mockGrafanaFetch.mockResolvedValue({ id: 10, url: '/d/dash-uid/test', version: 1 });

    const result = await handleDashboard('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).toHaveBeenCalledWith('my-bucket', 'dashboard.json');
    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/dashboards/db`,
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body.dashboard.uid).toBe('dash-uid');
    expect(body.dashboard.id).toBeNull();
    expect(body.overwrite).toBe(true);

    expect(result.PhysicalResourceId).toBe('dash-uid');
    expect(result.Data).toEqual({
      DashboardId: '10',
      Url: '/d/dash-uid/test',
      Version: '1',
    });
  });

  test('Update downloads from S3 and sends POST', async () => {
    mockDownloadAsset.mockResolvedValue(JSON.stringify({ title: 'Updated' }));
    mockGrafanaFetch.mockResolvedValue({ id: 10, url: '/d/dash-uid/test', version: 2 });

    const result = await handleDashboard('Update', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).toHaveBeenCalled();
    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/dashboards/db`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.Data?.Version).toBe('2');
  });

  test('Delete sends DELETE, does NOT call S3', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleDashboard('Delete', BASE_URL, TOKEN, PROPS, profile);

    expect(mockDownloadAsset).not.toHaveBeenCalled();
    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/dashboards/uid/dash-uid`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result.PhysicalResourceId).toBe('dash-uid');
  });

  test('returns PhysicalResourceId, DashboardId, Url, Version', async () => {
    mockDownloadAsset.mockResolvedValue(JSON.stringify({}));
    mockGrafanaFetch.mockResolvedValue({ id: 5, url: '/d/uid/slug', version: 3 });

    const result = await handleDashboard('Create', BASE_URL, TOKEN, PROPS, profile);
    expect(result).toEqual({
      PhysicalResourceId: 'dash-uid',
      Data: {
        DashboardId: '5',
        Url: '/d/uid/slug',
        Version: '3',
      },
    });
  });
});

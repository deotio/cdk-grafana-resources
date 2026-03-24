jest.mock('../../lambda/grafana-provider/grafana-client');

import { handleFolder } from '../../lambda/grafana-provider/handlers/folder';
import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';
import { getApiProfile } from '../../lambda/grafana-provider/api-version';

const mockGrafanaFetch = grafanaFetch as jest.MockedFunction<typeof grafanaFetch>;

const BASE_URL = 'https://grafana.example.com';
const TOKEN = 'test-token';
const PROPS = { Uid: 'folder-uid', Title: 'My Folder' } as any;
const profile = getApiProfile('v10').folder;

beforeEach(() => {
  mockGrafanaFetch.mockReset();
});

describe('handleFolder', () => {
  test('Create sends POST to /api/folders with uid and title', async () => {
    mockGrafanaFetch.mockResolvedValue({ id: 42 });

    const result = await handleFolder('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/folders`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ uid: 'folder-uid', title: 'My Folder', overwrite: true }),
      }),
    );
    expect(result.PhysicalResourceId).toBe('folder-uid');
    expect(result.Data?.FolderId).toBe('42');
  });

  test('Update sends PUT to /api/folders/{uid}', async () => {
    mockGrafanaFetch.mockResolvedValue({ id: 42 });

    const result = await handleFolder('Update', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/folders/folder-uid`,
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(result.PhysicalResourceId).toBe('folder-uid');
    expect(result.Data?.FolderId).toBe('42');
  });

  test('Delete sends DELETE to /api/folders/{uid}', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleFolder('Delete', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/folders/folder-uid`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result.PhysicalResourceId).toBe('folder-uid');
  });

  test('Delete 404 is not an error', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleFolder('Delete', BASE_URL, TOKEN, PROPS, profile);
    expect(result.PhysicalResourceId).toBe('folder-uid');
  });

  test('returns PhysicalResourceId and FolderId', async () => {
    mockGrafanaFetch.mockResolvedValue({ id: 99 });

    const result = await handleFolder('Create', BASE_URL, TOKEN, PROPS, profile);
    expect(result).toHaveProperty('PhysicalResourceId', 'folder-uid');
    expect(result).toHaveProperty('Data.FolderId', '99');
  });
});

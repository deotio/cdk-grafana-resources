jest.mock('../../lambda/grafana-provider/grafana-client');
jest.mock('../../lambda/grafana-provider/s3-asset');
jest.mock('../../lambda/grafana-provider/token');

import { handleDatasource } from '../../lambda/grafana-provider/handlers/datasource';
import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';
import { downloadAsset } from '../../lambda/grafana-provider/s3-asset';
import { getToken } from '../../lambda/grafana-provider/token';
import { getApiProfile } from '../../lambda/grafana-provider/api-version';

const mockGrafanaFetch = grafanaFetch as jest.MockedFunction<typeof grafanaFetch>;
const mockDownloadAsset = downloadAsset as jest.MockedFunction<typeof downloadAsset>;
const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;

const BASE_URL = 'https://grafana.example.com';
const TOKEN = 'test-token';
const PROPS = {
  Uid: 'ds-uid',
  Name: 'My Datasource',
  Type: 'prometheus',
  Access: 'proxy',
  IsDefault: 'false',
} as any;
const profile = getApiProfile('v10').datasource;

beforeEach(() => {
  mockGrafanaFetch.mockReset();
  mockDownloadAsset.mockReset();
  mockGetToken.mockReset();
});

describe('handleDatasource', () => {
  test('Create sends POST to /api/datasources', async () => {
    mockGrafanaFetch.mockResolvedValue({ id: 5 });

    const result = await handleDatasource('Create', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/datasources`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.PhysicalResourceId).toBe('ds-uid');
    expect(result.Data?.DatasourceId).toBe('5');
  });

  test('Update sends PUT to /api/datasources/uid/{uid}', async () => {
    mockGrafanaFetch.mockResolvedValue({ id: 5 });

    const result = await handleDatasource('Update', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/datasources/uid/ds-uid`,
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(result.Data?.DatasourceId).toBe('5');
  });

  test('Delete sends DELETE', async () => {
    mockGrafanaFetch.mockResolvedValue({});

    const result = await handleDatasource('Delete', BASE_URL, TOKEN, PROPS, profile);

    expect(mockGrafanaFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/datasources/uid/ds-uid`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result.PhysicalResourceId).toBe('ds-uid');
  });

  test('secureJsonData from Secrets Manager (calls getToken with the secret ARN)', async () => {
    const secretArn = 'arn:aws:secretsmanager:us-east-1:123:secret:secure-data';
    mockGetToken.mockResolvedValue(JSON.stringify({ password: 'secret' }));
    mockGrafanaFetch.mockResolvedValue({ id: 5 });

    const propsWithSecret = { ...PROPS, SecureJsonDataSecretArn: secretArn };
    await handleDatasource('Create', BASE_URL, TOKEN, propsWithSecret, profile);

    expect(mockGetToken).toHaveBeenCalledWith(secretArn);
    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body.secureJsonData).toEqual({ password: 'secret' });
  });

  test('secureJsonData from S3 asset (calls downloadAsset)', async () => {
    mockDownloadAsset.mockResolvedValue(JSON.stringify({ apiKey: 'key123' }));
    mockGrafanaFetch.mockResolvedValue({ id: 5 });

    const propsWithS3 = {
      ...PROPS,
      SecureJsonDataAssetBucket: 'secure-bucket',
      SecureJsonDataAssetKey: 'secure.json',
    };
    await handleDatasource('Create', BASE_URL, TOKEN, propsWithS3, profile);

    expect(mockDownloadAsset).toHaveBeenCalledWith('secure-bucket', 'secure.json');
    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body.secureJsonData).toEqual({ apiKey: 'key123' });
  });

  test('jsonDataJson parsed from inline prop', async () => {
    mockGrafanaFetch.mockResolvedValue({ id: 5 });

    const propsWithJson = { ...PROPS, JsonDataJson: '{"httpMethod":"POST"}' };
    await handleDatasource('Create', BASE_URL, TOKEN, propsWithJson, profile);

    const body = JSON.parse(mockGrafanaFetch.mock.calls[0][1].body as string);
    expect(body.jsonData).toEqual({ httpMethod: 'POST' });
  });
});

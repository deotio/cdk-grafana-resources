import { getToken, clearTokenCache } from '../../lambda/grafana-provider/token';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-secrets-manager', () => {
  const sendMock = jest.fn();
  return {
    SecretsManagerClient: jest.fn(() => ({ send: sendMock })),
    GetSecretValueCommand: jest.fn((input: any) => ({ input })),
    __sendMock: sendMock,
  };
});

const { __sendMock: sendMock } =
  jest.requireMock('@aws-sdk/client-secrets-manager') as any;

// Speed up retries
jest.useFakeTimers();

async function flushRetries() {
  for (let i = 0; i < 10; i++) {
    jest.advanceTimersByTime(15000);
    await Promise.resolve();
  }
}

beforeEach(() => {
  sendMock.mockReset();
  clearTokenCache();
});

describe('getToken', () => {
  test('returns secret string value', async () => {
    sendMock.mockResolvedValue({ SecretString: 'my-token' });

    const result = await getToken('arn:aws:secretsmanager:us-east-1:123:secret:test');
    expect(result).toBe('my-token');
  });

  test('caches by ARN (second call does not hit SM)', async () => {
    sendMock.mockResolvedValue({ SecretString: 'cached-token' });

    const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:cached';
    await getToken(arn);
    await getToken(arn);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test('different ARN fetches separately', async () => {
    sendMock.mockResolvedValue({ SecretString: 'token-val' });

    await getToken('arn:1');
    await getToken('arn:2');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test('clearTokenCache clears the cache (next call hits SM again)', async () => {
    sendMock.mockResolvedValue({ SecretString: 'token-val' });

    const arn = 'arn:aws:secretsmanager:us-east-1:123:secret:clear-test';
    await getToken(arn);
    clearTokenCache();
    await getToken(arn);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test('retries on throttling error', async () => {
    const throttleErr = new Error('Rate exceeded');
    (throttleErr as any).name = 'ThrottlingException';

    sendMock
      .mockRejectedValueOnce(throttleErr)
      .mockResolvedValueOnce({ SecretString: 'finally' });

    const promise = getToken('arn:throttle');
    await flushRetries();
    const result = await promise;
    expect(result).toBe('finally');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on AccessDeniedException (no retry)', async () => {
    const err = new Error('Access Denied');
    (err as any).name = 'AccessDeniedException';
    sendMock.mockRejectedValue(err);

    await expect(getToken('arn:denied')).rejects.toThrow('Access Denied');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test('throws immediately on ResourceNotFoundException (no retry)', async () => {
    const err = new Error('Not Found');
    (err as any).name = 'ResourceNotFoundException';
    sendMock.mockRejectedValue(err);

    await expect(getToken('arn:notfound')).rejects.toThrow('Not Found');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

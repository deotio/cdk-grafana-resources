import { downloadAsset } from '../../lambda/grafana-provider/s3-asset';

jest.mock('@aws-sdk/client-s3', () => {
  const sendMock = jest.fn();
  return {
    S3Client: jest.fn(() => ({ send: sendMock })),
    GetObjectCommand: jest.fn((input: any) => ({ input })),
    __sendMock: sendMock,
  };
});

const { __sendMock: sendMock } =
  jest.requireMock('@aws-sdk/client-s3') as any;

jest.useFakeTimers();

async function flushRetries() {
  for (let i = 0; i < 10; i++) {
    jest.advanceTimersByTime(15000);
    await Promise.resolve();
  }
}

beforeEach(() => {
  sendMock.mockReset();
});

describe('downloadAsset', () => {
  test('downloads and returns UTF-8 string', async () => {
    sendMock.mockResolvedValue({
      Body: { transformToString: jest.fn().mockResolvedValue('{"key":"value"}') },
    });

    const result = await downloadAsset('my-bucket', 'my-key');
    expect(result).toBe('{"key":"value"}');
  });

  test('retries on transient S3 errors', async () => {
    sendMock
      .mockRejectedValueOnce(new Error('ServiceUnavailable'))
      .mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValue('ok') },
      });

    const promise = downloadAsset('my-bucket', 'my-key');
    await flushRetries();
    const result = await promise;
    expect(result).toBe('ok');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test('throws after all retries exhausted', async () => {
    sendMock.mockRejectedValue(new Error('ServiceUnavailable'));

    const promise = downloadAsset('my-bucket', 'my-key', 2);
    await flushRetries();
    await expect(promise).rejects.toThrow('Failed to download asset');
  });
});

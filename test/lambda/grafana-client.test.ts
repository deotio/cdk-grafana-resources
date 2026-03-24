// Mock timers so we don't actually wait for backoff delays
jest.useFakeTimers();

// We need to import after setting up the fetch mock
const originalFetch = global.fetch;

let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

import { grafanaFetch } from '../../lambda/grafana-provider/grafana-client';

// Helper to advance timers while the promise is pending
async function flushRetries() {
  // Run all pending timers + microtasks
  for (let i = 0; i < 10; i++) {
    jest.advanceTimersByTime(15000);
    await Promise.resolve();
  }
}

describe('grafanaFetch', () => {
  test('2xx returns parsed JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 1 }),
    });

    const result = await grafanaFetch('https://grafana/api/test', { method: 'GET' });
    expect(result).toEqual({ id: 1 });
  });

  test('empty response returns {}', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const result = await grafanaFetch('https://grafana/api/test', { method: 'GET' });
    expect(result).toEqual({});
  });

  test('4xx throws immediately with no retry (fetch call count = 1)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(
      grafanaFetch('https://grafana/api/test', { method: 'POST' }),
    ).rejects.toThrow('400');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('4xx error message truncates body to 200 chars', async () => {
    const longBody = 'x'.repeat(300);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => longBody,
    });

    await expect(
      grafanaFetch('https://grafana/api/test', { method: 'POST' }),
    ).rejects.toThrow('x'.repeat(200) + '...');
  });

  test('404 on DELETE returns {} (not an error)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    });

    const result = await grafanaFetch('https://grafana/api/test', { method: 'DELETE' });
    expect(result).toEqual({});
  });

  test('5xx retries and succeeds on 2nd attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      });

    const promise = grafanaFetch('https://grafana/api/test', { method: 'GET' });
    await flushRetries();
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('network error (fetch throws) retries and succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ recovered: true }),
      });

    const promise = grafanaFetch('https://grafana/api/test', { method: 'GET' });
    await flushRetries();
    const result = await promise;
    expect(result).toEqual({ recovered: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('all retries exhausted throws final error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'Bad Gateway',
    });

    const promise = grafanaFetch('https://grafana/api/test', { method: 'GET' }, 2);
    await flushRetries();
    await expect(promise).rejects.toThrow('failed after');
    expect(mockFetch).toHaveBeenCalledTimes(3); // 0, 1, 2
  });

  test('error messages never contain "Bearer" or authorization info', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    try {
      await grafanaFetch('https://grafana/api/test', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret-token-123' },
      });
      fail('Should have thrown');
    } catch (err: unknown) {
      const msg = String(err);
      expect(msg).not.toContain('Bearer');
      expect(msg).not.toContain('secret-token-123');
    }
  });
});

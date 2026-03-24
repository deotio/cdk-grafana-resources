/**
 * Thin wrapper around native fetch with retry logic for Grafana API calls.
 *
 * - 2xx: parse JSON (empty body -> {})
 * - 404 on DELETE: return {} (resource already gone)
 * - 4xx: throw immediately, truncate body to 200 chars, never include auth headers
 * - 5xx / network errors: retry with exponential backoff
 */
export async function grafanaFetch(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (err) {
      // Network errors (DNS failure, connection reset, timeout) — retry
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(
        `Grafana API network error after ${retries + 1} attempts: ${init.method} ${url}: ${err}`,
      );
    }

    if (response.ok) {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }

    // 4xx — client errors, never retry
    if (response.status >= 400 && response.status < 500) {
      // Special case: 404 on DELETE is not an error (resource already gone)
      if (init.method === 'DELETE' && response.status === 404) {
        return {};
      }
      const body = await response.text();
      const safeBody = body.length > 200 ? body.slice(0, 200) + '...' : body;
      throw new Error(
        `Grafana API ${response.status}: ${safeBody} (${init.method} ${url})`,
      );
    }

    // 5xx — retry with exponential backoff
    if (attempt < retries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(
    `Grafana API failed after ${retries + 1} attempts: ${init.method} ${url}`,
  );
}

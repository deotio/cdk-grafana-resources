import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/** Module-level cache keyed by secret ARN. Persists across warm Lambda invocations. */
const tokenCache = new Map<string, string>();

/**
 * Retrieve a secret string from Secrets Manager with caching and retry.
 *
 * - Cache hit: return immediately
 * - AccessDeniedException / ResourceNotFoundException: throw immediately (permanent)
 * - Transient errors: retry with exponential backoff
 */
export async function getToken(
  secretArn: string,
  retries = 3,
): Promise<string> {
  const cached = tokenCache.get(secretArn);
  if (cached) {
    return cached;
  }

  const client = new SecretsManagerClient({});

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.send(
        new GetSecretValueCommand({ SecretId: secretArn }),
      );

      const value = response.SecretString;
      if (!value) {
        throw new Error(`Secret ${secretArn} has no string value`);
      }

      tokenCache.set(secretArn, value);
      return value;
    } catch (err: unknown) {
      // Don't retry permanent errors
      const code = (err as { name?: string }).name ?? '';
      if (
        ['AccessDeniedException', 'ResourceNotFoundException'].includes(code)
      ) {
        throw err;
      }
      // Retry transient errors (throttling, network)
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Failed to retrieve secret ${secretArn} after ${retries + 1} attempts`,
  );
}

/** Clear the module-level token cache. Called at the start of each onEvent invocation. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const VALID_ENDPOINT = /^[a-zA-Z0-9.-]+(:[0-9]+)?$/;
const VALID_UID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Validates a Grafana endpoint string.
 * Must be a hostname with optional port — no path, query string, or userinfo.
 * Prevents SSRF via path injection.
 */
export function validateEndpoint(endpoint: string): void {
  if (!VALID_ENDPOINT.test(endpoint)) {
    throw new Error(
      `Invalid grafanaEndpoint: must be a hostname (optional port), got: '${endpoint}'`,
    );
  }
}

/**
 * Validates a Grafana resource UID.
 * Must start with alphanumeric and contain only alphanumeric, underscore, or hyphen.
 * Prevents URL path traversal when interpolated into API paths.
 */
export function validateUid(uid: string): void {
  if (!VALID_UID.test(uid)) {
    throw new Error(
      `Invalid uid: must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, got: '${uid}'`,
    );
  }
}

/**
 * Writes a JSON string to a temporary file with a SHA-256 hash in the filename
 * for stable asset hashing. Same content produces the same filename, avoiding
 * unnecessary CloudFormation updates.
 *
 * @returns The absolute path to the temporary file.
 */
export function writeJsonToTempFile(json: string): string {
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  const filePath = path.join(os.tmpdir(), `cdk-grafana-${hash}.json`);
  fs.writeFileSync(filePath, json, 'utf-8');
  return filePath;
}

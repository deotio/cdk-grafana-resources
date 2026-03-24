import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaProviderProps } from './grafana-provider';

/**
 * Supported Grafana API version identifiers.
 *
 * - `'v10'` — Grafana 10.x and Amazon Managed Grafana (as of 2025).
 * - `'v11'` — Grafana 11.x (currently identical to v10; will diverge
 *   when Grafana 11 introduces breaking API changes).
 *
 * The version controls which API paths, request shapes, and response
 * parsers the Lambda handler uses. Adding support for a future Grafana
 * version requires only updating the API profile registry in
 * `lambda/grafana-provider/api-version.ts`.
 */
export type GrafanaApiVersion = 'v10' | 'v11';

/**
 * Base properties shared by all Grafana resource constructs.
 */
export interface GrafanaResourceProps {
  /**
   * The Grafana workspace endpoint (hostname only, without protocol).
   * Must be a valid hostname — no path, query string, or userinfo.
   * Example: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com'
   *
   * Validated at synth time (construct constructor) and at deploy time
   * (Lambda handler) to prevent SSRF.
   */
  readonly grafanaEndpoint: string;

  /**
   * The Secrets Manager secret containing the Grafana API token.
   * The secret value must be a plain string (the token), not JSON.
   */
  readonly apiTokenSecret: secretsmanager.ISecret;

  /**
   * Grafana API version to target. Controls which API paths and request
   * shapes the provider Lambda uses.
   * @default 'v10'
   */
  readonly grafanaApiVersion?: GrafanaApiVersion;

  /**
   * Configuration for the shared Custom Resource provider Lambda.
   * Only takes effect on the first construct in the stack that creates
   * the provider. Subsequent constructs reuse the existing provider.
   * @default - provider created with default settings (log retention: ONE_WEEK, no VPC)
   */
  readonly providerProps?: GrafanaProviderProps;
}

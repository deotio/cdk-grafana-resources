import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaProviderProps } from './grafana-provider';
import type { GrafanaApiVersion } from '../lambda/grafana-provider/api-version';

// Re-export so consumers can import from the construct library
export type { GrafanaApiVersion } from '../lambda/grafana-provider/api-version';

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

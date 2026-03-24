import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaProvider } from './grafana-provider';
import { validateEndpoint } from './validation';

/**
 * Properties for a GrafanaNotificationPolicy construct.
 */
export interface GrafanaNotificationPolicyProps extends GrafanaResourceProps {
  /**
   * The notification policy tree as a JSON string.
   * This replaces the entire policy tree — Grafana only supports
   * a single policy tree, not individual policy CRUD.
   */
  readonly policyJson: string;
}

/**
 * Manages the Grafana notification policy tree (routing of alerts to contact points).
 *
 * Unlike other constructs, the notification policy is a singleton per Grafana workspace.
 * Only one GrafanaNotificationPolicy should exist per workspace. Multiple stacks
 * targeting the same workspace would overwrite each other.
 */
export class GrafanaNotificationPolicy extends Construct {
  constructor(scope: Construct, id: string, props: GrafanaNotificationPolicyProps) {
    super(scope, id);

    validateEndpoint(props.grafanaEndpoint);

    const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
    provider.grantSecretRead(props.apiTokenSecret);

    new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.provider.serviceToken,
      properties: {
        GrafanaResourceType: 'NotificationPolicy',
        GrafanaEndpoint: props.grafanaEndpoint,
        GrafanaApiVersion: props.grafanaApiVersion,
        SecretArn: props.apiTokenSecret.secretArn,
        PolicyJson: props.policyJson,
      },
    });
  }
}

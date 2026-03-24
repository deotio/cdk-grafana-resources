import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaProvider } from './grafana-provider';
import { validateEndpoint, validateUid, writeJsonToTempFile } from './validation';

/**
 * Properties for a GrafanaContactPoint construct.
 */
export interface GrafanaContactPointProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the contact point.
   */
  readonly uid: string;

  /**
   * Display name of the contact point.
   */
  readonly name: string;

  /**
   * The contact point type (e.g., 'email', 'slack', 'opsgenie', 'pagerduty', 'webhook').
   */
  readonly type: string;

  /**
   * Type-specific settings as a JSON string.
   * Uploaded as a CDK S3 asset — it does NOT appear in CloudFormation state.
   */
  readonly settingsJson: string;
}

/**
 * Creates or updates a Grafana contact point for alert notifications.
 */
export class GrafanaContactPoint extends Construct {
  /** The contact point UID. */
  public readonly uid: string;

  constructor(scope: Construct, id: string, props: GrafanaContactPointProps) {
    super(scope, id);

    validateEndpoint(props.grafanaEndpoint);
    validateUid(props.uid);

    this.uid = props.uid;

    const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
    provider.grantSecretRead(props.apiTokenSecret);

    // Upload settings JSON as S3 asset (may contain webhook URLs, API keys)
    const asset = new s3_assets.Asset(this, 'SettingsAsset', {
      path: writeJsonToTempFile(props.settingsJson),
    });
    asset.grantRead(provider.handler);

    new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.provider.serviceToken,
      properties: {
        GrafanaResourceType: 'ContactPoint',
        GrafanaEndpoint: props.grafanaEndpoint,
        GrafanaApiVersion: props.grafanaApiVersion,
        SecretArn: props.apiTokenSecret.secretArn,
        Uid: props.uid,
        Name: props.name,
        Type: props.type,
        SettingsAssetBucket: asset.s3BucketName,
        SettingsAssetKey: asset.s3ObjectKey,
      },
    });
  }
}

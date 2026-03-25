import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaProvider } from './grafana-provider';
import { GrafanaFolder } from './grafana-folder';
import { validateEndpoint, validateUid, writeJsonToTempFile } from './validation';

/**
 * Properties for a GrafanaAlertRule construct.
 */
export interface GrafanaAlertRuleProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the alert rule.
   */
  readonly uid: string;

  /**
   * The folder containing this alert rule.
   * Accepts a GrafanaFolder construct (recommended — automatically creates
   * a CloudFormation dependency) or a plain UID string.
   */
  readonly folderUid: GrafanaFolder | string;

  /**
   * The alert rule group name. Rules within the same group are evaluated together.
   */
  readonly ruleGroup: string;

  /**
   * The alert rule definition as a JSON string.
   * Uploaded as a CDK S3 asset (alert rules with complex queries can
   * exceed the ~8KB CloudFormation payload limit).
   */
  readonly ruleJson: string;
}

/**
 * Creates or updates a Grafana-managed alert rule.
 */
export class GrafanaAlertRule extends Construct {
  /** The alert rule UID. */
  public readonly uid: string;

  constructor(scope: Construct, id: string, props: GrafanaAlertRuleProps) {
    super(scope, id);

    validateEndpoint(props.grafanaEndpoint);
    validateUid(props.uid);

    this.uid = props.uid;

    const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
    provider.grantSecretRead(props.apiTokenSecret);

    // Resolve folderUid: GrafanaFolder | string -> string
    const resolvedFolderUid = props.folderUid instanceof GrafanaFolder
      ? props.folderUid.uid
      : props.folderUid;

    if (props.folderUid instanceof GrafanaFolder) {
      this.node.addDependency(props.folderUid);
    } else {
      validateUid(resolvedFolderUid);
    }

    // Upload rule JSON as S3 asset
    const asset = new s3_assets.Asset(this, 'RuleAsset', {
      path: writeJsonToTempFile(props.ruleJson),
    });
    asset.grantRead(provider.handler);

    new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.provider.serviceToken,
      properties: {
        GrafanaResourceType: 'AlertRule',
        GrafanaEndpoint: props.grafanaEndpoint,
        GrafanaApiVersion: props.grafanaApiVersion,
        SecretArn: props.apiTokenSecret.secretArn,
        Uid: props.uid,
        FolderUid: resolvedFolderUid,
        RuleGroup: props.ruleGroup,
        RuleAssetBucket: asset.s3BucketName,
        RuleAssetKey: asset.s3ObjectKey,
      },
    });
  }
}

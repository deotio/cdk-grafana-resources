import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaProvider } from './grafana-provider';
import { GrafanaFolder } from './grafana-folder';
import { validateEndpoint, validateUid, writeJsonToTempFile } from './validation';

/**
 * Properties for a GrafanaDashboard construct.
 */
export interface GrafanaDashboardProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the dashboard.
   * If the dashboard JSON contains a `uid` field, this prop takes precedence.
   */
  readonly uid: string;

  /**
   * The folder to place the dashboard in.
   * Accepts a GrafanaFolder construct (recommended — automatically creates
   * a CloudFormation dependency) or a plain UID string.
   */
  readonly folderUid: GrafanaFolder | string;

  /**
   * The dashboard model as a JSON string.
   * This is the `dashboard` object from Grafana's export format.
   * The construct uploads this JSON to S3 as a CDK asset and passes the
   * S3 location to the Lambda, which reads it at deploy time.
   */
  readonly dashboardJson: string;

  /**
   * Optional commit message shown in Grafana's dashboard version history.
   * @default 'Deployed by cdk-grafana-resources'
   */
  readonly message?: string;
}

/**
 * Creates or updates a Grafana dashboard within a folder.
 */
export class GrafanaDashboard extends Construct {
  /** The dashboard UID (same as input). */
  public readonly uid: string;

  /** The Grafana-assigned numeric dashboard ID. */
  public readonly dashboardId: string;

  /** The dashboard URL path (e.g., '/d/abc123/my-dashboard'). */
  public readonly url: string;

  /** The dashboard version number (increments on each update). */
  public readonly version: string;

  constructor(scope: Construct, id: string, props: GrafanaDashboardProps) {
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

    // Upload dashboard JSON as S3 asset
    const asset = new s3_assets.Asset(this, 'DashboardAsset', {
      path: writeJsonToTempFile(props.dashboardJson),
    });
    asset.grantRead(provider.handler);

    const resource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.provider.serviceToken,
      properties: {
        GrafanaResourceType: 'Dashboard',
        GrafanaEndpoint: props.grafanaEndpoint,
        GrafanaApiVersion: props.grafanaApiVersion,
        SecretArn: props.apiTokenSecret.secretArn,
        Uid: props.uid,
        FolderUid: resolvedFolderUid,
        DashboardAssetBucket: asset.s3BucketName,
        DashboardAssetKey: asset.s3ObjectKey,
        Message: props.message,
      },
    });

    this.dashboardId = resource.getAttString('DashboardId');
    this.url = resource.getAttString('Url');
    this.version = resource.getAttString('Version');
  }
}

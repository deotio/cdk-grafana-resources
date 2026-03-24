import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaProvider } from './grafana-provider';
import { validateEndpoint, validateUid, writeJsonToTempFile } from './validation';

/**
 * Properties for a GrafanaDatasource construct.
 */
export interface GrafanaDatasourceProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the datasource.
   */
  readonly uid: string;

  /**
   * Display name of the datasource.
   */
  readonly name: string;

  /**
   * Datasource type (e.g., 'cloudwatch', 'prometheus', 'elasticsearch').
   */
  readonly type: string;

  /**
   * Datasource access mode.
   * @default 'proxy'
   */
  readonly access?: 'proxy' | 'direct';

  /**
   * Type-specific configuration as a JSON string.
   * Merged into the `jsonData` field of the Grafana API request.
   * Passed inline (non-sensitive, typically small).
   */
  readonly jsonDataJson?: string;

  /**
   * Secrets for the datasource (e.g., database passwords, API keys).
   * Merged into the `secureJsonData` field.
   *
   * Accepts either:
   * - An `ISecret` whose value is a JSON string — resolved at deploy time
   *   by the Lambda. The secret value never appears in CloudFormation state.
   * - A plain JSON string — uploaded as a CDK S3 asset (not stored in
   *   CloudFormation properties).
   *
   * Prefer `ISecret` for production datasources.
   */
  readonly secureJsonData?: secretsmanager.ISecret | string;

  /**
   * Whether this is the default datasource of its type.
   * @default false
   */
  readonly isDefault?: boolean;
}

/**
 * Creates or updates a Grafana datasource.
 */
export class GrafanaDatasource extends Construct {
  /** The datasource UID. */
  public readonly uid: string;

  /** The Grafana-assigned numeric datasource ID. */
  public readonly datasourceId: string;

  constructor(scope: Construct, id: string, props: GrafanaDatasourceProps) {
    super(scope, id);

    validateEndpoint(props.grafanaEndpoint);
    validateUid(props.uid);

    this.uid = props.uid;

    const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
    provider.grantSecretRead(props.apiTokenSecret);

    const crProps: Record<string, string | undefined> = {
      GrafanaResourceType: 'Datasource',
      GrafanaEndpoint: props.grafanaEndpoint,
      GrafanaApiVersion: props.grafanaApiVersion,
      SecretArn: props.apiTokenSecret.secretArn,
      Uid: props.uid,
      Name: props.name,
      Type: props.type,
      Access: props.access ?? 'proxy',
      IsDefault: String(props.isDefault ?? false),
    };

    if (props.jsonDataJson) {
      crProps.JsonDataJson = props.jsonDataJson;
    }

    // secureJsonData: ISecret -> pass ARN; string -> upload S3 asset
    if (props.secureJsonData) {
      if (typeof props.secureJsonData === 'string') {
        const asset = new s3_assets.Asset(this, 'SecureJsonDataAsset', {
          path: writeJsonToTempFile(props.secureJsonData),
        });
        asset.grantRead(provider.handler);
        crProps.SecureJsonDataAssetBucket = asset.s3BucketName;
        crProps.SecureJsonDataAssetKey = asset.s3ObjectKey;
      } else {
        // ISecret — Lambda resolves the value at runtime
        provider.grantSecretRead(props.secureJsonData);
        crProps.SecureJsonDataSecretArn = props.secureJsonData.secretArn;
      }
    }

    const resource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.provider.serviceToken,
      properties: crProps,
    });

    this.datasourceId = resource.getAttString('DatasourceId');
  }
}

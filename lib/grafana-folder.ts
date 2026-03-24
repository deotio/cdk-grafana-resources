import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaProvider } from './grafana-provider';
import { validateEndpoint, validateUid } from './validation';

/**
 * Properties for a GrafanaFolder construct.
 */
export interface GrafanaFolderProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the folder.
   * Used for idempotent create/update. Cannot be changed after creation.
   * Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ (validated at synth time).
   */
  readonly uid: string;

  /**
   * Display title of the folder in Grafana.
   */
  readonly title: string;
}

/**
 * Creates or updates a Grafana folder.
 */
export class GrafanaFolder extends Construct {
  /** The folder UID (same as input — exposed for cross-referencing). */
  public readonly uid: string;

  /** The Grafana-assigned numeric folder ID. */
  public readonly folderId: string;

  /** Pass-through of the API token secret for reuse by child constructs. */
  public readonly apiTokenSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: GrafanaFolderProps) {
    super(scope, id);

    validateEndpoint(props.grafanaEndpoint);
    validateUid(props.uid);

    this.uid = props.uid;
    this.apiTokenSecret = props.apiTokenSecret;

    const provider = GrafanaProvider.getOrCreate(this, props.providerProps);
    provider.grantSecretRead(props.apiTokenSecret);

    const resource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.provider.serviceToken,
      properties: {
        GrafanaResourceType: 'Folder',
        GrafanaEndpoint: props.grafanaEndpoint,
        GrafanaApiVersion: props.grafanaApiVersion,
        SecretArn: props.apiTokenSecret.secretArn,
        Uid: props.uid,
        Title: props.title,
      },
    });

    this.folderId = resource.getAttString('FolderId');
  }
}

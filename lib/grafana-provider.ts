import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

/**
 * Configuration for the shared Custom Resource provider Lambda.
 */
export interface GrafanaProviderProps {
  /**
   * CloudWatch Logs retention for the provider Lambda and framework Lambdas.
   * @default logs.RetentionDays.ONE_WEEK
   */
  readonly logRetention?: logs.RetentionDays;

  /**
   * VPC to place the provider Lambda in.
   * Required when the Grafana endpoint is only reachable from within a VPC
   * or has IP allowlisting.
   */
  readonly vpc?: ec2.IVpc;

  /** Subnet selection for the Lambda when deployed in a VPC. */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /** Security groups for the Lambda when deployed in a VPC. */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Maximum number of concurrent Lambda invocations.
   * Limits blast radius on Grafana API rate limits and prevents consuming
   * account-level Lambda concurrency.
   * @default 10
   */
  readonly reservedConcurrentExecutions?: number;
}

/**
 * Singleton provider for all Grafana custom resources in a stack.
 *
 * Uses a single Lambda function to handle all Grafana resource types,
 * caching API tokens for the duration of each invocation.
 */
export class GrafanaProvider extends Construct {
  /** The CDK Provider framework construct. */
  public readonly provider: Provider;

  /**
   * The Lambda handler function. Exposed so constructs can grant it
   * additional permissions (e.g., S3 asset read, secret read).
   */
  public readonly handler: NodejsFunction;

  /**
   * Returns the singleton GrafanaProvider for the given stack,
   * creating it if it doesn't exist.
   *
   * Props are only used on first creation. If the provider already exists,
   * props are ignored. Place the first construct that creates the provider
   * early in the stack to control its configuration.
   */
  public static getOrCreate(scope: Construct, props?: GrafanaProviderProps): GrafanaProvider {
    const stack = cdk.Stack.of(scope);
    const id = 'GrafanaCustomResourceProvider';
    const existing = stack.node.tryFindChild(id) as GrafanaProvider;
    return existing || new GrafanaProvider(stack, id, props);
  }

  private constructor(scope: Construct, id: string, props?: GrafanaProviderProps) {
    super(scope, id);

    this.handler = new NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '..', 'lambda', 'grafana-provider', 'index.ts'),
      runtime: Runtime.NODEJS_22_X,
      handler: 'onEvent',
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      description: 'cdk-grafana-resources: manages Grafana resources via HTTP API',
      logRetention: props?.logRetention ?? logs.RetentionDays.ONE_WEEK,
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
      reservedConcurrentExecutions: props?.reservedConcurrentExecutions ?? 10,
      vpc: props?.vpc,
      vpcSubnets: props?.vpcSubnets,
      securityGroups: props?.securityGroups,
    });

    this.provider = new Provider(this, 'Provider', {
      onEventHandler: this.handler,
      logRetention: props?.logRetention ?? logs.RetentionDays.ONE_WEEK,
    });
  }

  /**
   * Grant the Lambda permission to read a specific secret.
   * Called by each construct that uses a different secret.
   */
  public grantSecretRead(secret: secretsmanager.ISecret): void {
    secret.grantRead(this.handler);
  }
}

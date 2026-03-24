import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Properties for a GrafanaCloudWatchRole construct.
 */
export interface GrafanaCloudWatchRoleProps {
  /**
   * The ARN of the Grafana workspace's service role in the central account.
   * This role will be allowed to assume the CloudWatch role.
   */
  readonly grafanaServiceRoleArn: string;

  /**
   * Optional role name. If not specified, CDK generates a unique name.
   */
  readonly roleName?: string;

  /**
   * Additional CloudWatch actions to grant beyond the default read-only set.
   * The default set covers all actions needed for Grafana CloudWatch datasource queries.
   * @default - no additional actions
   */
  readonly additionalActions?: string[];
}

/**
 * Default CloudWatch read-only actions required by the Grafana CloudWatch datasource.
 * These actions do not support resource-level permissions (require Resource: '*').
 * See: https://docs.aws.amazon.com/grafana/latest/userguide/AMG-manage-permissions.html
 */
const CLOUDWATCH_READ_ACTIONS = [
  'cloudwatch:DescribeAlarmsForMetric',
  'cloudwatch:DescribeAlarmHistory',
  'cloudwatch:DescribeAlarms',
  'cloudwatch:ListMetrics',
  'cloudwatch:GetMetricData',
  'cloudwatch:GetMetricStatistics',
  'cloudwatch:GetInsightRuleReport',
  'logs:DescribeLogGroups',
  'logs:GetLogGroupFields',
  'logs:StartQuery',
  'logs:StopQuery',
  'logs:GetQueryResults',
  'logs:GetLogEvents',
  'ec2:DescribeTags',
  'ec2:DescribeInstances',
  'ec2:DescribeRegions',
  'tag:GetResources',
];

/**
 * Creates an IAM role in the project account that the Grafana workspace's
 * service role can assume. The role grants read-only CloudWatch and
 * CloudWatch Logs access, enabling the Grafana CloudWatch datasource
 * to query metrics and logs from the project account.
 *
 * Use this together with `GrafanaDatasource` to register the CloudWatch
 * datasource in Grafana:
 *
 * ```typescript
 * const cwRole = new GrafanaCloudWatchRole(this, 'GrafanaCW', {
 *   grafanaServiceRoleArn: 'arn:aws:iam::999999999999:role/grafana-service-role',
 * });
 *
 * new GrafanaDatasource(this, 'CloudWatch', {
 *   grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
 *   apiTokenSecret: secret,
 *   uid: 'my-app-cloudwatch',
 *   name: 'My App CloudWatch',
 *   type: 'cloudwatch',
 *   jsonDataJson: JSON.stringify({
 *     defaultRegion: 'eu-central-1',
 *     authType: 'assumeRole',
 *     assumeRoleArn: cwRole.roleArn,
 *   }),
 * });
 * ```
 */
export class GrafanaCloudWatchRole extends Construct {
  /** The IAM role. */
  public readonly role: iam.Role;

  /** The ARN of the IAM role. Pass this to the CloudWatch datasource's assumeRoleArn. */
  public readonly roleArn: string;

  constructor(scope: Construct, id: string, props: GrafanaCloudWatchRoleProps) {
    super(scope, id);

    this.role = new iam.Role(this, 'Role', {
      roleName: props.roleName,
      assumedBy: new iam.ArnPrincipal(props.grafanaServiceRoleArn),
      description: 'Allows Grafana workspace to read CloudWatch metrics and logs from this account',
    });

    const actions = [...CLOUDWATCH_READ_ACTIONS, ...(props.additionalActions ?? [])];

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions,
        resources: ['*'], // CloudWatch read APIs do not support resource-level permissions
      }),
    );

    this.roleArn = this.role.roleArn;
  }
}

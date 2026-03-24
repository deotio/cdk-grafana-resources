import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { GrafanaCloudWatchRole } from '../lib/grafana-cloudwatch-role';

const GRAFANA_SERVICE_ROLE_ARN =
  'arn:aws:iam::999999999999:role/grafana-service-role';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  return { app, stack };
}

describe('GrafanaCloudWatchRole', () => {
  test('creates IAM role with trust policy for the Grafana service role', () => {
    const { stack } = makeStack();

    new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              AWS: GRAFANA_SERVICE_ROLE_ARN,
            },
          }),
        ]),
      }),
    });
  });

  test('grants CloudWatch read-only actions', () => {
    const { stack } = makeStack();

    new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'cloudwatch:ListMetrics',
              'cloudwatch:GetMetricData',
              'logs:StartQuery',
              'logs:GetQueryResults',
              'ec2:DescribeInstances',
            ]),
            Effect: 'Allow',
            Resource: '*',
          }),
        ]),
      }),
    });
  });

  test('includes all expected default actions', () => {
    const { stack } = makeStack();

    new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
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
            ]),
          }),
        ]),
      }),
    });
  });

  test('additionalActions are appended to the policy', () => {
    const { stack } = makeStack();

    new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
      additionalActions: ['xray:GetTraceSummaries', 'xray:BatchGetTraces'],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'cloudwatch:ListMetrics',
              'xray:GetTraceSummaries',
              'xray:BatchGetTraces',
            ]),
          }),
        ]),
      }),
    });
  });

  test('custom roleName is applied', () => {
    const { stack } = makeStack();

    new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
      roleName: 'grafana-cloudwatch-read',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'grafana-cloudwatch-read',
    });
  });

  test('exposes roleArn for use with GrafanaDatasource', () => {
    const { stack } = makeStack();

    const cwRole = new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
    });

    expect(cwRole.roleArn).toBeDefined();
    expect(cwRole.role).toBeDefined();
  });

  test('role has a description', () => {
    const { stack } = makeStack();

    new GrafanaCloudWatchRole(stack, 'CWRole', {
      grafanaServiceRoleArn: GRAFANA_SERVICE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Role', {
      Description: Match.stringLikeRegexp('Grafana.*CloudWatch'),
    });
  });
});

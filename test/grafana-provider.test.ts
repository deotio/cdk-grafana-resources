import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { GrafanaDashboard } from '../lib/grafana-dashboard';
import { GrafanaFolder } from '../lib/grafana-folder';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaProvider', () => {
  test('singleton: two constructs share one handler Lambda', () => {
    const { stack, secret } = makeStack();

    new GrafanaDashboard(stack, 'D1', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash1',
      folderUid: 'folder1',
      dashboardJson: '{}',
    });
    new GrafanaDashboard(stack, 'D2', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash2',
      folderUid: 'folder1',
      dashboardJson: '{}',
    });

    const template = Template.fromStack(stack);
    // There should be exactly one Lambda whose description contains 'cdk-grafana-resources'
    const lambdas = template.findResources('AWS::Lambda::Function', {
      Properties: {
        Description: Match.stringLikeRegexp('cdk-grafana-resources'),
      },
    });
    // The handler Lambda — should be exactly 1 (the framework on-event wrapper may also exist but without our description)
    const handlerCount = Object.keys(lambdas).length;
    expect(handlerCount).toBe(1);
  });

  test('log retention is set on the handler Lambda', () => {
    const { stack, secret } = makeStack();

    new GrafanaFolder(stack, 'F1', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'folder1',
      title: 'Test Folder',
    });

    const template = Template.fromStack(stack);
    // LogRetention custom resource should exist (CDK creates AWS::Custom::LogRetention)
    template.hasResourceProperties('Custom::LogRetention', {
      RetentionInDays: 7, // ONE_WEEK
    });
  });

  test('reserved concurrency defaults to 10', () => {
    const { stack, secret } = makeStack();

    new GrafanaFolder(stack, 'F1', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'folder1',
      title: 'Test',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: Match.stringLikeRegexp('cdk-grafana-resources'),
      ReservedConcurrentExecutions: 10,
    });
  });

  test('VPC config applied when provided', () => {
    const { stack, secret } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc');

    new GrafanaFolder(stack, 'F1', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'folder1',
      title: 'Test',
      providerProps: { vpc },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: Match.stringLikeRegexp('cdk-grafana-resources'),
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
        SecurityGroupIds: Match.anyValue(),
      }),
    });
  });
});

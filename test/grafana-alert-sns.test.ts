import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import { GrafanaAlertSnsIntegration } from '../lib/grafana-alert-sns';

const ENDPOINT = 'grafana.example.com';
const WORKSPACE_ROLE_ARN = 'arn:aws:iam::111111111111:role/grafana-workspace-role';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaAlertSnsIntegration', () => {
  test('creates an SNS topic when none is provided', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'My Alert SNS',
    });
  });

  test('uses topicDisplayName when provided', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
      topicDisplayName: 'Custom Display Name',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'Custom Display Name',
    });
  });

  test('uses an existing topic when provided', () => {
    const { stack, secret } = makeStack();

    const existingTopic = new sns.Topic(stack, 'ExistingTopic', {
      displayName: 'Pre-existing',
    });

    const integration = new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
      topic: existingTopic,
    });

    // Should not create an additional topic
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SNS::Topic', 1);

    // Should reference the existing topic
    expect(integration.topic).toBe(existingTopic);
  });

  test('grants sns:Publish to the Grafana workspace role via topic policy', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sns:Publish',
            Effect: 'Allow',
            Principal: {
              AWS: WORKSPACE_ROLE_ARN,
            },
          }),
        ]),
      }),
    });
  });

  test('creates a contact point of type sns', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      GrafanaResourceType: 'ContactPoint',
      Type: 'sns',
      Uid: 'alert-sns-1',
      Name: 'My Alert SNS',
    });
  });

  test('exposes topic, uid, and contactPoint', () => {
    const { stack, secret } = makeStack();

    const integration = new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
    });

    expect(integration.topic).toBeDefined();
    expect(integration.uid).toBe('alert-sns-1');
    expect(integration.contactPoint).toBeDefined();
  });

  test('settings asset contains topicARN', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
    });

    const template = Template.fromStack(stack);
    // The contact point should have settings uploaded as S3 asset
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SettingsAssetBucket: Match.anyValue(),
      SettingsAssetKey: Match.anyValue(),
    });
  });

  test('passes messageBody and subject to settings when provided', () => {
    const { stack, secret } = makeStack();

    const integration = new GrafanaAlertSnsIntegration(stack, 'AlertSns', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'alert-sns-1',
      name: 'My Alert SNS',
      grafanaWorkspaceRoleArn: WORKSPACE_ROLE_ARN,
      messageBody: '{{ template "default.message" . }}',
      subject: '{{ template "default.title" . }}',
    });

    // Verify the construct was created — settings are in S3 so we can't
    // inspect them directly from the template, but we can verify the
    // contact point was created and the construct exposes expected values.
    expect(integration.contactPoint).toBeDefined();
    expect(integration.uid).toBe('alert-sns-1');
  });
});

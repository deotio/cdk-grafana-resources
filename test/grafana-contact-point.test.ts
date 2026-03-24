import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaContactPoint } from '../lib/grafana-contact-point';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaContactPoint', () => {
  test('has SettingsAssetBucket and SettingsAssetKey', () => {
    const { stack, secret } = makeStack();

    new GrafanaContactPoint(stack, 'CP', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'cp1',
      name: 'My Slack',
      type: 'slack',
      settingsJson: '{"url":"https://hooks.slack.com/xxx"}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SettingsAssetBucket: Match.anyValue(),
      SettingsAssetKey: Match.anyValue(),
    });
  });

  test('has Name and Type in properties', () => {
    const { stack, secret } = makeStack();

    new GrafanaContactPoint(stack, 'CP', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'cp1',
      name: 'My Slack',
      type: 'slack',
      settingsJson: '{}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      Name: 'My Slack',
      Type: 'slack',
    });
  });

  test('secret grant present', () => {
    const { stack, secret } = makeStack();

    new GrafanaContactPoint(stack, 'CP', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'cp1',
      name: 'My Slack',
      type: 'slack',
      settingsJson: '{}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });
});

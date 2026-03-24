import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaNotificationPolicy } from '../lib/grafana-notification-policy';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaNotificationPolicy', () => {
  test('PolicyJson inline in template', () => {
    const { stack, secret } = makeStack();
    const policyJson = '{"receiver":"default","routes":[]}';

    new GrafanaNotificationPolicy(stack, 'NP', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      policyJson,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      PolicyJson: policyJson,
    });
  });

  test('SecretArn present', () => {
    const { stack, secret } = makeStack();

    new GrafanaNotificationPolicy(stack, 'NP', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      policyJson: '{}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SecretArn: Match.anyValue(),
    });
  });

  test('GrafanaResourceType is NotificationPolicy', () => {
    const { stack, secret } = makeStack();

    new GrafanaNotificationPolicy(stack, 'NP', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      policyJson: '{}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      GrafanaResourceType: 'NotificationPolicy',
    });
  });
});

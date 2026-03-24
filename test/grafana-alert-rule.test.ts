import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaAlertRule } from '../lib/grafana-alert-rule';
import { GrafanaFolder } from '../lib/grafana-folder';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaAlertRule', () => {
  test('has RuleAssetBucket and RuleAssetKey in properties', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertRule(stack, 'Rule', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'rule1',
      folderUid: 'folder1',
      ruleGroup: 'my-group',
      ruleJson: '{"condition":"A"}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      GrafanaResourceType: 'AlertRule',
      RuleAssetBucket: Match.anyValue(),
      RuleAssetKey: Match.anyValue(),
    });
  });

  test('auto dependency on folder when GrafanaFolder passed', () => {
    const { stack, secret } = makeStack();

    const folder = new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'myfolder',
      title: 'My Folder',
    });

    new GrafanaAlertRule(stack, 'Rule', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'rule1',
      folderUid: folder,
      ruleGroup: 'my-group',
      ruleJson: '{}',
    });

    const template = Template.fromStack(stack);
    template.hasResource('AWS::CloudFormation::CustomResource', {
      Properties: Match.objectLike({
        GrafanaResourceType: 'AlertRule',
      }),
      DependsOn: Match.anyValue(),
    });
  });

  test('secret grant present', () => {
    const { stack, secret } = makeStack();

    new GrafanaAlertRule(stack, 'Rule', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'rule1',
      folderUid: 'folder1',
      ruleGroup: 'my-group',
      ruleJson: '{}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.anyValue(),
          }),
        ]),
      }),
    });
  });
});

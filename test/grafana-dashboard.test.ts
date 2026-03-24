import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaDashboard } from '../lib/grafana-dashboard';
import { GrafanaFolder } from '../lib/grafana-folder';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaDashboard', () => {
  test('has DashboardAssetBucket and DashboardAssetKey (not DashboardJson)', () => {
    const { stack, secret } = makeStack();

    new GrafanaDashboard(stack, 'Dash', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash1',
      folderUid: 'folder1',
      dashboardJson: '{"panels":[]}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      DashboardAssetBucket: Match.anyValue(),
      DashboardAssetKey: Match.anyValue(),
    });
    // DashboardJson should NOT be present in template
    const resources = template.findResources('AWS::CloudFormation::CustomResource', {
      Properties: {
        DashboardJson: Match.anyValue(),
      },
    });
    expect(Object.keys(resources)).toHaveLength(0);
  });

  test('passing GrafanaFolder as folderUid creates DependsOn', () => {
    const { stack, secret } = makeStack();

    const folder = new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'myfolder',
      title: 'My Folder',
    });

    new GrafanaDashboard(stack, 'Dash', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash1',
      folderUid: folder,
      dashboardJson: '{}',
    });

    const template = Template.fromStack(stack);
    // Find the dashboard custom resource and check it depends on the folder
    template.hasResource('AWS::CloudFormation::CustomResource', {
      Properties: Match.objectLike({
        GrafanaResourceType: 'Dashboard',
      }),
      DependsOn: Match.anyValue(),
    });
  });

  test('passing string as folderUid does NOT create DependsOn', () => {
    const { stack, secret } = makeStack();

    new GrafanaDashboard(stack, 'Dash', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash1',
      folderUid: 'some-folder-uid',
      dashboardJson: '{}',
    });

    const template = Template.fromStack(stack);
    // The custom resource should not have DependsOn (or DependsOn should not include folder-related resources)
    const crResources = template.findResources('AWS::CloudFormation::CustomResource', {
      Properties: Match.objectLike({
        GrafanaResourceType: 'Dashboard',
      }),
    });
    const logicalIds = Object.keys(crResources);
    expect(logicalIds).toHaveLength(1);
    const cr = crResources[logicalIds[0]];
    // Should have no DependsOn
    expect(cr.DependsOn).toBeUndefined();
  });

  test('S3 asset gets IAM read grant', () => {
    const { stack, secret } = makeStack();

    new GrafanaDashboard(stack, 'Dash', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash1',
      folderUid: 'folder1',
      dashboardJson: '{}',
    });

    const template = Template.fromStack(stack);
    // IAM policy should grant s3:GetObject
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:GetObject*', 's3:GetBucket*']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });
});

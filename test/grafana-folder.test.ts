import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaFolder } from '../lib/grafana-folder';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaFolder', () => {
  test('synthesizes Custom Resource with correct properties', () => {
    const { stack, secret } = makeStack();

    new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'my-folder',
      title: 'My Folder',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      GrafanaResourceType: 'Folder',
      Uid: 'my-folder',
      Title: 'My Folder',
    });
  });

  test('SecretArn is an ARN string (not the secret value)', () => {
    const { stack, secret } = makeStack();

    new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'my-folder',
      title: 'My Folder',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SecretArn: Match.objectLike({
        Ref: Match.anyValue(),
      }),
    });
  });

  test('IAM policy grants secretsmanager:GetSecretValue on the secret', () => {
    const { stack, secret } = makeStack();

    new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'my-folder',
      title: 'My Folder',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.anyValue(),
            Effect: 'Allow',
            Resource: Match.objectLike({
              Ref: Match.anyValue(),
            }),
          }),
        ]),
      }),
    });
  });

  test('invalid UID throws at synth', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'BadFolder', {
        grafanaEndpoint: ENDPOINT,
        apiTokenSecret: secret,
        uid: 'bad/uid',
        title: 'Bad',
      });
    }).toThrow(/Invalid uid/);
  });

  test('UID with .. throws at synth', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'BadFolder', {
        grafanaEndpoint: ENDPOINT,
        apiTokenSecret: secret,
        uid: '../traversal',
        title: 'Bad',
      });
    }).toThrow(/Invalid uid/);
  });

  test('invalid endpoint throws at synth', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'BadFolder', {
        grafanaEndpoint: 'grafana.example.com/path',
        apiTokenSecret: secret,
        uid: 'folder1',
        title: 'Bad',
      });
    }).toThrow(/Invalid grafanaEndpoint/);
  });
});

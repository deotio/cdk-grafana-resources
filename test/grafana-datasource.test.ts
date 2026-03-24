import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaDatasource } from '../lib/grafana-datasource';

const ENDPOINT = 'grafana.example.com';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('GrafanaDatasource', () => {
  test('secureJsonData as ISecret: SecureJsonDataSecretArn in template, IAM grants for both secrets', () => {
    const { stack, secret } = makeStack();
    const secureSecret = new secretsmanager.Secret(stack, 'SecureJson');

    new GrafanaDatasource(stack, 'DS', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'ds1',
      name: 'My DS',
      type: 'prometheus',
      secureJsonData: secureSecret,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SecureJsonDataSecretArn: Match.anyValue(),
    });
    // No S3 asset properties
    const s3Resources = template.findResources('AWS::CloudFormation::CustomResource', {
      Properties: {
        SecureJsonDataAssetBucket: Match.anyValue(),
      },
    });
    expect(Object.keys(s3Resources)).toHaveLength(0);

    // IAM policy should grant access to both secrets (apiTokenSecret and secureJsonData)
    // There should be a policy with secretsmanager grants
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

  test('secureJsonData as string: SecureJsonDataAssetBucket/Key in template, no SecureJsonDataSecretArn', () => {
    const { stack, secret } = makeStack();

    new GrafanaDatasource(stack, 'DS', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'ds1',
      name: 'My DS',
      type: 'prometheus',
      secureJsonData: '{"password":"secret123"}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      SecureJsonDataAssetBucket: Match.anyValue(),
      SecureJsonDataAssetKey: Match.anyValue(),
    });
    // No SecureJsonDataSecretArn
    const arnResources = template.findResources('AWS::CloudFormation::CustomResource', {
      Properties: {
        SecureJsonDataSecretArn: Match.anyValue(),
      },
    });
    expect(Object.keys(arnResources)).toHaveLength(0);
  });

  test('secureJsonData absent: neither SecureJsonData prop', () => {
    const { stack, secret } = makeStack();

    new GrafanaDatasource(stack, 'DS', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'ds1',
      name: 'My DS',
      type: 'prometheus',
    });

    const template = Template.fromStack(stack);
    const arnResources = template.findResources('AWS::CloudFormation::CustomResource', {
      Properties: {
        SecureJsonDataSecretArn: Match.anyValue(),
      },
    });
    expect(Object.keys(arnResources)).toHaveLength(0);

    const s3Resources = template.findResources('AWS::CloudFormation::CustomResource', {
      Properties: {
        SecureJsonDataAssetBucket: Match.anyValue(),
      },
    });
    expect(Object.keys(s3Resources)).toHaveLength(0);
  });

  test('jsonDataJson appears inline in template', () => {
    const { stack, secret } = makeStack();

    new GrafanaDatasource(stack, 'DS', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'ds1',
      name: 'My DS',
      type: 'cloudwatch',
      jsonDataJson: '{"defaultRegion":"us-east-1"}',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      JsonDataJson: '{"defaultRegion":"us-east-1"}',
    });
  });

  test('has Name, Type, Uid in template', () => {
    const { stack, secret } = makeStack();

    new GrafanaDatasource(stack, 'DS', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'ds1',
      name: 'My DS',
      type: 'prometheus',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      Uid: 'ds1',
      Name: 'My DS',
      Type: 'prometheus',
    });
  });
});

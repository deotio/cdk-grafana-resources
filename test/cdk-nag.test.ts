import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { GrafanaFolder } from '../lib/grafana-folder';
import { GrafanaDashboard } from '../lib/grafana-dashboard';
import { GrafanaAlertRule } from '../lib/grafana-alert-rule';
import { GrafanaContactPoint } from '../lib/grafana-contact-point';
import { GrafanaDatasource } from '../lib/grafana-datasource';
import { GrafanaNotificationPolicy } from '../lib/grafana-notification-policy';

const ENDPOINT = 'grafana.example.com';

describe('cdk-nag AwsSolutions', () => {
  test('stack with all constructs passes cdk-nag with suppressions', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'NagTestStack');

    const secret = new secretsmanager.Secret(stack, 'Token');
    const secureJsonSecret = new secretsmanager.Secret(stack, 'SecureJson');

    const folder = new GrafanaFolder(stack, 'Folder', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'folder1',
      title: 'Test Folder',
    });

    new GrafanaDashboard(stack, 'Dashboard', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'dash1',
      folderUid: folder,
      dashboardJson: '{"panels":[]}',
    });

    new GrafanaAlertRule(stack, 'AlertRule', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'rule1',
      folderUid: folder,
      ruleGroup: 'test-group',
      ruleJson: '{"condition":"A"}',
    });

    new GrafanaContactPoint(stack, 'ContactPoint', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'cp1',
      name: 'Test CP',
      type: 'email',
      settingsJson: '{"addresses":"test@example.com"}',
    });

    new GrafanaDatasource(stack, 'Datasource', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      uid: 'ds1',
      name: 'Test DS',
      type: 'prometheus',
      secureJsonData: secureJsonSecret,
    });

    new GrafanaNotificationPolicy(stack, 'NotifPolicy', {
      grafanaEndpoint: ENDPOINT,
      apiTokenSecret: secret,
      policyJson: '{"receiver":"default"}',
    });

    // Suppress known CDK framework issues — scoped to the provider construct
    const providerPath = '/NagTestStack/GrafanaCustomResourceProvider';

    NagSuppressions.addResourceSuppressionsByPath(stack, [
      `${providerPath}/Handler/ServiceRole/Resource`,
      `${providerPath}/Provider/framework-onEvent/ServiceRole/Resource`,
    ], [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'CDK-managed Lambda execution role uses AWS managed policy (AWSLambdaBasicExecutionRole)',
      },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(stack, [
      `${providerPath}/Handler/ServiceRole/DefaultPolicy/Resource`,
      `${providerPath}/Provider/framework-onEvent/ServiceRole/DefaultPolicy/Resource`,
    ], [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions from CDK grant methods for S3 asset reads and Secrets Manager access',
      },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(stack, [
      `${providerPath}/Handler/Resource`,
      `${providerPath}/Provider/framework-onEvent/Resource`,
    ], [
      {
        id: 'AwsSolutions-L1',
        reason: 'Lambda runtime is NODEJS_22_X; cdk-nag may not recognise it as latest',
      },
    ]);

    // Test secrets do not require rotation
    NagSuppressions.addResourceSuppressionsByPath(stack, [
      '/NagTestStack/Token/Resource',
      '/NagTestStack/SecureJson/Resource',
    ], [
      {
        id: 'AwsSolutions-SMG4',
        reason: 'Test secrets do not require rotation for unit tests',
      },
    ]);

    Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

    // Force synthesis
    const messages = Annotations.fromStack(stack);
    const errors = messages.findError('*', Match.anyValue());
    expect(errors).toHaveLength(0);
  });
});

import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GrafanaFolder } from '../lib/grafana-folder';

function makeStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const secret = new secretsmanager.Secret(stack, 'Token');
  return { app, stack, secret };
}

describe('Security validation', () => {
  test('endpoint with / throws', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'F', {
        grafanaEndpoint: 'grafana.example.com/api',
        apiTokenSecret: secret,
        uid: 'folder1',
        title: 'Bad',
      });
    }).toThrow(/Invalid grafanaEndpoint/);
  });

  test('endpoint with ? throws', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'F', {
        grafanaEndpoint: 'grafana.example.com?evil=1',
        apiTokenSecret: secret,
        uid: 'folder1',
        title: 'Bad',
      });
    }).toThrow(/Invalid grafanaEndpoint/);
  });

  test('UID with ../ throws', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'F', {
        grafanaEndpoint: 'grafana.example.com',
        apiTokenSecret: secret,
        uid: '../etc/passwd',
        title: 'Bad',
      });
    }).toThrow(/Invalid uid/);
  });

  test('UID with / throws', () => {
    const { stack, secret } = makeStack();
    expect(() => {
      new GrafanaFolder(stack, 'F', {
        grafanaEndpoint: 'grafana.example.com',
        apiTokenSecret: secret,
        uid: 'bad/uid',
        title: 'Bad',
      });
    }).toThrow(/Invalid uid/);
  });
});

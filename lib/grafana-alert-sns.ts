import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { GrafanaResourceProps } from './grafana-resource-props';
import { GrafanaContactPoint } from './grafana-contact-point';

/**
 * Properties for a GrafanaAlertSnsIntegration construct.
 */
export interface GrafanaAlertSnsIntegrationProps extends GrafanaResourceProps {
  /**
   * Stable unique identifier for the contact point.
   */
  readonly uid: string;

  /**
   * Display name of the contact point in Grafana.
   */
  readonly name: string;

  /**
   * The ARN of the IAM role that the Grafana workspace assumes.
   * This role will be granted `sns:Publish` on the created topic.
   */
  readonly grafanaWorkspaceRoleArn: string;

  /**
   * An existing SNS topic to use instead of creating a new one.
   * When provided, the construct grants publish permissions but does not create a topic.
   * @default - a new SNS topic is created
   */
  readonly topic?: sns.ITopic;

  /**
   * Optional display name for the SNS topic (only used when creating a new topic).
   * @default - same as the contact point name
   */
  readonly topicDisplayName?: string;

  /**
   * Optional message body template for the Grafana SNS notification.
   * Uses Grafana template syntax (e.g. `{{ template "default.message" . }}`).
   * @default - Grafana default message body
   */
  readonly messageBody?: string;

  /**
   * Optional subject template for the Grafana SNS notification.
   * @default - Grafana default subject
   */
  readonly subject?: string;
}

/**
 * Creates an SNS topic (or uses an existing one) and a Grafana contact point
 * wired together, with the correct IAM permissions for the Grafana workspace
 * to publish alerts to the topic.
 *
 * ```typescript
 * const alertSns = new GrafanaAlertSnsIntegration(this, 'AlertSns', {
 *   grafanaEndpoint: 'g-abc123.grafana-workspace.eu-central-1.amazonaws.com',
 *   apiTokenSecret: secret,
 *   uid: 'my-alert-sns',
 *   name: 'My Alert SNS',
 *   grafanaWorkspaceRoleArn: 'arn:aws:iam::111111111111:role/grafana-workspace-role',
 * });
 *
 * // Subscribe an email address to the topic
 * alertSns.topic.addSubscription(
 *   new subscriptions.EmailSubscription('oncall@example.com'),
 * );
 * ```
 */
export class GrafanaAlertSnsIntegration extends Construct {
  /** The SNS topic that receives Grafana alert notifications. */
  public readonly topic: sns.ITopic;

  /** The Grafana contact point UID. */
  public readonly uid: string;

  /** The Grafana contact point construct. */
  public readonly contactPoint: GrafanaContactPoint;

  constructor(scope: Construct, id: string, props: GrafanaAlertSnsIntegrationProps) {
    super(scope, id);

    this.uid = props.uid;

    // Create or use an existing topic
    if (props.topic) {
      this.topic = props.topic;
    } else {
      this.topic = new sns.Topic(this, 'Topic', {
        displayName: props.topicDisplayName ?? props.name,
      });
    }

    // Grant the Grafana workspace role permission to publish to the topic
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        principals: [new iam.ArnPrincipal(props.grafanaWorkspaceRoleArn)],
        resources: [this.topic.topicArn],
      }),
    );

    // Build contact point settings
    const settings: Record<string, string> = {
      topicARN: this.topic.topicArn,
    };
    if (props.messageBody !== undefined) {
      settings.body = props.messageBody;
    }
    if (props.subject !== undefined) {
      settings.subject = props.subject;
    }

    // Create the Grafana contact point
    this.contactPoint = new GrafanaContactPoint(this, 'ContactPoint', {
      grafanaEndpoint: props.grafanaEndpoint,
      apiTokenSecret: props.apiTokenSecret,
      providerProps: props.providerProps,
      uid: props.uid,
      name: props.name,
      type: 'sns',
      settingsJson: JSON.stringify(settings),
    });
  }
}

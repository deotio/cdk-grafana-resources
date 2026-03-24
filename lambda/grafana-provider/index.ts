import type {
  CdkCustomResourceEvent,
  CdkCustomResourceResponse,
} from 'aws-lambda';
import { getToken, clearTokenCache } from './token';
import {
  handleFolder,
  handleDashboard,
  handleAlertRule,
  handleContactPoint,
  handleDatasource,
  handleNotificationPolicy,
} from './handlers';
import { getApiProfile } from './api-version';
import type { ApiProfile, ResourceProfile } from './api-version';

const VALID_ENDPOINT = /^[a-zA-Z0-9.-]+(:[0-9]+)?$/;

type ResourceHandler = (
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
  profile: ResourceProfile,
) => Promise<CdkCustomResourceResponse>;

const handlers: Record<string, { handler: ResourceHandler; profileKey: keyof ApiProfile }> = {
  Folder: { handler: handleFolder, profileKey: 'folder' },
  Dashboard: { handler: handleDashboard, profileKey: 'dashboard' },
  AlertRule: { handler: handleAlertRule, profileKey: 'alertRule' },
  ContactPoint: { handler: handleContactPoint, profileKey: 'contactPoint' },
  Datasource: { handler: handleDatasource, profileKey: 'datasource' },
  NotificationPolicy: { handler: handleNotificationPolicy, profileKey: 'notificationPolicy' },
};

export async function onEvent(
  event: CdkCustomResourceEvent,
): Promise<CdkCustomResourceResponse> {
  // Clear token cache on each CloudFormation invocation to ensure
  // rotated tokens are picked up (the cache is module-level state
  // that persists across warm Lambda invocations).
  clearTokenCache();

  const props = event.ResourceProperties;

  // Validate required properties
  const resourceType = props.GrafanaResourceType;
  if (!resourceType || !handlers[resourceType]) {
    throw new Error(
      `Unknown or missing GrafanaResourceType: ${resourceType}`,
    );
  }
  if (!props.GrafanaEndpoint || !props.SecretArn) {
    throw new Error(
      'Missing required properties: GrafanaEndpoint, SecretArn',
    );
  }

  // Validate endpoint to prevent SSRF — must be a hostname, no path/query
  if (!VALID_ENDPOINT.test(props.GrafanaEndpoint)) {
    throw new Error(
      `Invalid GrafanaEndpoint: must be a hostname (optional port), got: ${props.GrafanaEndpoint}`,
    );
  }

  const action = event.RequestType; // 'Create', 'Update', 'Delete'

  // Resolve API profile for the requested Grafana version
  const apiProfile = getApiProfile(props.GrafanaApiVersion);
  const { handler, profileKey } = handlers[resourceType];
  const resourceProfile = apiProfile[profileKey];

  // Structured logging — safe fields only
  console.log(
    JSON.stringify({
      action,
      resourceType,
      uid: props.Uid,
      apiVersion: props.GrafanaApiVersion ?? 'v10',
    }),
  );

  const token = await getToken(props.SecretArn);
  const baseUrl = `https://${props.GrafanaEndpoint}`;

  return handler(action, baseUrl, token, props, resourceProfile);
}

import type { CdkCustomResourceResponse } from 'aws-lambda';
import { grafanaFetch } from '../grafana-client';
import type { ResourceProfile } from '../api-version';

export async function handleNotificationPolicy(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
  profile: ResourceProfile,
): Promise<CdkCustomResourceResponse> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...profile.extraHeaders,
  };

  if (action === 'Delete') {
    // Reset to Grafana's default policy tree (version-aware via profile)
    const route = profile.routes.delete;
    await grafanaFetch(route.path(baseUrl), {
      method: route.method,
      headers,
      body: JSON.stringify(profile.deleteBody),
    });
    return { PhysicalResourceId: 'notification-policy' };
  }

  // Create or Update — full replacement
  const policy = JSON.parse(props.PolicyJson);
  const body = profile.buildBody({ policy });
  const route = action === 'Create' ? profile.routes.create : profile.routes.update;

  await grafanaFetch(route.path(baseUrl), {
    method: route.method,
    headers,
    body: JSON.stringify(body),
  });

  return { PhysicalResourceId: 'notification-policy' };
}

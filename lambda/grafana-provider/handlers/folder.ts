import type { CdkCustomResourceResponse } from 'aws-lambda';
import { grafanaFetch } from '../grafana-client';
import type { ResourceProfile } from '../api-version';

export async function handleFolder(
  action: string,
  baseUrl: string,
  token: string,
  props: Record<string, string>,
  profile: ResourceProfile,
): Promise<CdkCustomResourceResponse> {
  const uid = props.Uid;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...profile.extraHeaders,
  };

  if (action === 'Delete') {
    const route = profile.routes.delete;
    await grafanaFetch(route.path(baseUrl, uid), { method: route.method, headers });
    return { PhysicalResourceId: uid };
  }

  const route = action === 'Create' ? profile.routes.create : profile.routes.update;
  const body = profile.buildBody({ uid, title: props.Title });

  const result = await grafanaFetch(route.path(baseUrl, uid), {
    method: route.method,
    headers,
    body: JSON.stringify(body),
  });

  return {
    PhysicalResourceId: uid,
    Data: profile.parseResponse(result),
  };
}

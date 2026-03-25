import type { CdkCustomResourceResponse } from 'aws-lambda';
import { grafanaFetch } from '../grafana-client';
import { downloadAsset } from '../s3-asset';
import { safeJsonParse } from '../json-parse';
import type { ResourceProfile } from '../api-version';

export async function handleDashboard(
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

  // Create or Update — read dashboard JSON from S3 asset
  const dashboardJson = await downloadAsset(
    props.DashboardAssetBucket,
    props.DashboardAssetKey,
  );
  const dashboard = safeJsonParse(dashboardJson, 'dashboard JSON from S3 asset') as Record<string, unknown>;
  dashboard.uid = uid;
  dashboard.id = null;

  const route = action === 'Create' ? profile.routes.create : profile.routes.update;
  const body = profile.buildBody({
    dashboard,
    folderUid: props.FolderUid,
    message: props.Message,
  });

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

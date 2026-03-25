import type { CdkCustomResourceResponse } from 'aws-lambda';
import { grafanaFetch } from '../grafana-client';
import { downloadAsset } from '../s3-asset';
import { safeJsonParse } from '../json-parse';
import type { ResourceProfile } from '../api-version';

export async function handleContactPoint(
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

  // Read settings from S3 asset (may contain webhook URLs, API keys)
  const settingsStr = await downloadAsset(
    props.SettingsAssetBucket,
    props.SettingsAssetKey,
  );
  const settings = safeJsonParse(settingsStr, 'contact point settings from S3 asset');

  const body = profile.buildBody({ uid, name: props.Name, type: props.Type, settings });

  if (action === 'Create') {
    const createRoute = profile.routes.create;
    try {
      await grafanaFetch(createRoute.path(baseUrl, uid), {
        method: createRoute.method,
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      // 409 Conflict — UID already exists. Fall back to PUT.
      if (String(err).includes('409')) {
        const updateRoute = profile.routes.update;
        await grafanaFetch(updateRoute.path(baseUrl, uid), {
          method: updateRoute.method,
          headers,
          body: JSON.stringify(body),
        });
      } else {
        throw err;
      }
    }
  } else {
    // Update
    const updateRoute = profile.routes.update;
    await grafanaFetch(updateRoute.path(baseUrl, uid), {
      method: updateRoute.method,
      headers,
      body: JSON.stringify(body),
    });
  }

  return { PhysicalResourceId: uid };
}

import type { CdkCustomResourceResponse } from 'aws-lambda';
import { grafanaFetch } from '../grafana-client';
import { getToken } from '../token';
import { downloadAsset } from '../s3-asset';
import type { ResourceProfile } from '../api-version';

export async function handleDatasource(
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

  // Build the datasource object
  const body: Record<string, unknown> = {
    uid,
    name: props.Name,
    type: props.Type,
    access: props.Access || 'proxy',
    isDefault: props.IsDefault === 'true',
  };

  // jsonDataJson is inline (non-sensitive, small)
  if (props.JsonDataJson) {
    body.jsonData = JSON.parse(props.JsonDataJson);
  }

  // secureJsonData: resolved from Secrets Manager OR S3 asset
  if (props.SecureJsonDataSecretArn) {
    const secretValue = await getToken(props.SecureJsonDataSecretArn);
    body.secureJsonData = JSON.parse(secretValue);
  } else if (props.SecureJsonDataAssetBucket) {
    const assetValue = await downloadAsset(
      props.SecureJsonDataAssetBucket,
      props.SecureJsonDataAssetKey,
    );
    body.secureJsonData = JSON.parse(assetValue);
  }

  const builtBody = profile.buildBody({ body });
  const route = action === 'Create' ? profile.routes.create : profile.routes.update;

  const result = await grafanaFetch(route.path(baseUrl, uid), {
    method: route.method,
    headers,
    body: JSON.stringify(builtBody),
  });

  return {
    PhysicalResourceId: uid,
    Data: profile.parseResponse(result),
  };
}

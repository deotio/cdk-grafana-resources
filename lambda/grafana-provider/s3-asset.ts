import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Download an S3 object as a UTF-8 string with retry and exponential backoff.
 */
export async function downloadAsset(
  bucket: string,
  key: string,
  retries = 3,
): Promise<string> {
  const client = new S3Client({});

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return await response.Body!.transformToString('utf-8');
    } catch (err) {
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(
        `Failed to download asset s3://${bucket}/${key}: ${err}`,
      );
    }
  }

  throw new Error(
    `Failed to download asset after ${retries + 1} attempts`,
  );
}

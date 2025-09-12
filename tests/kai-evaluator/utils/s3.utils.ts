import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export async function uploadObject(file: string, path: string, contentType = 'application/json') {
  if (!file || !path) {
    throw new Error('File content and path are required');
  }
  if (!isAWSConfigured() || !process.env.KAI_QE_S3_BUCKET_NAME) {
    throw new Error(
      'AWS_DEFAULT_REGION and KAI_QE_S3_BUCKET_NAME environment variables are required'
    );
  }

  const client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
  try {
    return client.send(
      new PutObjectCommand({
        Key: path,
        Body: file,
        Bucket: process.env.KAI_QE_S3_BUCKET_NAME,
        ContentType: contentType,
      })
    );
  } catch (error: any) {
    console.error(error);
    throw new Error(`Failed to upload object to S3: ${error.message}`);
  }
}

export async function downloadObject(path: string) {
  if (!path) {
    throw new Error('Path is required');
  }

  if (!process.env.AWS_DEFAULT_REGION || !process.env.KAI_QE_S3_BUCKET_NAME) {
    throw new Error(
      'AWS_DEFAULT_REGION and KAI_QE_S3_BUCKET_NAME environment variables are required'
    );
  }

  const client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
  try {
    return client.send(
      new GetObjectCommand({
        Key: path,
        Bucket: process.env.KAI_QE_S3_BUCKET_NAME,
      })
    );
  } catch (error: any) {
    throw new Error(`Failed to download object from S3: ${error.message}`);
  }
}

export function isAWSConfigured(): boolean {
  return (
    !!process.env.AWS_ACCESS_KEY_ID &&
    !!process.env.AWS_SECRET_ACCESS_KEY &&
    !!process.env.AWS_DEFAULT_REGION
  );
}

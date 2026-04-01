import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export type S3Config = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Uploads a document (PDF or Markdown) to the configured S3 bucket.
 * The credentials must be provided.
 */
export async function uploadDocumentToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  config: S3Config,
): Promise<string> {
  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  });

  await client.send(command);

  // Return the S3 URI format
  return `s3://${config.bucket}/${fileName}`;
}

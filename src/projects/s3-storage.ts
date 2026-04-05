import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export type S3Config = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
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
    endpoint: config.endpoint,
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

export async function uploadBrowserScreenshot(
  base64Data: string,
  executionId: string,
): Promise<string | undefined> {
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY || process.env.S3_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET || process.env.S3_KEY_SECRET;
  const endpoint = process.env.S3_ENDPOINT;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    console.warn("S3 credentials incomplete. Skipping screenshot upload.");
    return undefined;
  }

  const client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const buffer = Buffer.from(base64Data, "base64");
  const fileName = `screenshots/${executionId}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fileName,
    Body: buffer,
    ContentType: "image/png",
    ACL: "public-read", // Attempt to make it publicly readable so the UI can just link it
  });

  try {
    await client.send(command);
    // Generate the public HTTPS URL for the frontend
    if (endpoint) {
      // If endpoint is custom/provided, we'll try to build a path-style URL or substitute
      if (endpoint.includes(".amazonaws.com") && !endpoint.includes(bucket)) {
        return `https://${bucket}.s3.${region}.amazonaws.com/${fileName}`;
      }
      // For generic endpoints (e.g., Minio or Cloudflare R2), path style usually works
      return `${endpoint.replace(/\/$/, "")}/${bucket}/${fileName}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${fileName}`;
  } catch (error) {
    console.error("Failed to upload screenshot to S3:", error);
    return undefined;
  }
}

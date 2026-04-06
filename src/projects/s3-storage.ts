import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { generateBrowserThumbnail } from "../browser/screenshot.js";

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
): Promise<{ imageUrl: string; thumbnailUrl: string } | undefined> {
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
  const now = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);
  const fileName = `screenshots/${executionId}/${now}-${randomSuffix}.png`;

  // Base URL for links
  const baseUrl = endpoint
    ? endpoint.includes(".amazonaws.com") && !endpoint.includes(bucket)
      ? `https://${bucket}.s3.${region}.amazonaws.com/`
      : `${endpoint.replace(/\/$/, "")}/${bucket}/`
    : `https://${bucket}.s3.${region}.amazonaws.com/`;

  const imageUrl = `${baseUrl}${fileName}`;

  try {
    // 1. Upload main screenshot
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: buffer,
        ContentType: "image/png",
        ACL: "public-read",
      }),
    );

    // 2. Upload thumbnail
    let thumbnailUrl = imageUrl;
    try {
      const thumb = await generateBrowserThumbnail(buffer);
      const thumbExt = thumb.contentType === "image/webp" ? "webp" : "jpg";
      const thumbName = `thumbnails/${executionId}/${now}-${randomSuffix}.${thumbExt}`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: thumbName,
          Body: thumb.buffer,
          ContentType: thumb.contentType,
          ACL: "public-read",
        }),
      );
      thumbnailUrl = `${baseUrl}${thumbName}`;
    } catch (err) {
      console.warn("Failed to generate/upload thumbnail to S3:", err);
    }

    return { imageUrl, thumbnailUrl };
  } catch (error) {
    console.error("Failed to upload screenshot to S3:", error);
    return undefined;
  }
}

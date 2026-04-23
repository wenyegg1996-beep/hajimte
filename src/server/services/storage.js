import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../../../storage/uploads');

let s3Client = null;

function isS3Enabled() {
  return Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

function getS3Client() {
  if (!isS3Enabled()) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export async function saveImageObject({ buffer, mimeType, originalName }) {
  const ext = path.extname(originalName || '') || '.jpg';
  const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;

  if (isS3Enabled()) {
    const client = getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));

    const publicBase = env.S3_PUBLIC_BASE_URL;
    const url = publicBase
      ? `${publicBase.replace(/\/$/, '')}/${key}`
      : null;

    return { storageKey: key, url };
  }

  await fs.mkdir(uploadsDir, { recursive: true });
  const fullPath = path.join(uploadsDir, key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return {
    storageKey: key,
    url: `/storage/${key}`,
  };
}

export async function deleteImageObject(storageKey) {
  if (!storageKey) return;

  if (isS3Enabled()) {
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
    }));
    return;
  }

  const fullPath = path.join(uploadsDir, storageKey);
  await fs.rm(fullPath, { force: true });
}

export function getUploadsDir() {
  return uploadsDir;
}

export async function getImageBuffer(storageKey) {
  if (isS3Enabled()) {
    const client = getS3Client();
    const response = await client.send(new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
    }));
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), contentType: response.ContentType };
  }

  const fullPath = path.join(uploadsDir, storageKey);
  const buffer = await fs.readFile(fullPath);
  return { buffer, contentType: null };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';

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
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3Client;
}

function toStorageError(action, error) {
  const status = error?.$metadata?.httpStatusCode || 502;
  const code = error?.Code || error?.code || 'STORAGE_ERROR';
  const requestId = error?.$metadata?.requestId || null;

  return new AppError(
    `Image ${action} failed`,
    status,
    code,
    {
      provider: 's3',
      message: error?.message || 'Storage request failed',
      requestId,
    },
  );
}

export async function saveImageObject({ buffer, mimeType, originalName }) {
  const ext = path.extname(originalName || '') || '.jpg';
  const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;

  if (isS3Enabled()) {
    const client = getS3Client();
    try {
      await client.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }));
    } catch (error) {
      throw toStorageError('upload', error);
    }

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
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
      }));
    } catch (error) {
      throw toStorageError('delete', error);
    }
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
    let response;
    try {
      response = await client.send(new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
      }));
    } catch (error) {
      throw toStorageError('read', error);
    }
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

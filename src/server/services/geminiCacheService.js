import crypto from 'node:crypto';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { fetchJson } from '../lib/fetchJson.js';
import { getCollectionModel } from './db.js';

const inFlightCreation = new Map();

// In-memory cache: avoids a MongoDB round-trip on every Gemini request.
// Invalidated immediately on write; stale after 60 s at most.
const memCache = new Map(); // modelName → { value, expiresAt }
const MEM_CACHE_TTL_MS = 60_000;

function hashPrompt(prompt) {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

function getCacheModel() {
  return getCollectionModel('gemini_cache_pool');
}

async function persistCache(modelName, value) {
  const CacheModel = getCacheModel();
  await CacheModel.updateOne(
    { _id: modelName },
    { $set: { ...value, updatedAt: new Date() } },
    { upsert: true }
  );
  memCache.set(modelName, { value, expiresAt: Date.now() + MEM_CACHE_TTL_MS });
}

export async function hydrateGeminiCachePool(modelName = env.GEMINI_MODEL) {
  const cached = memCache.get(modelName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const CacheModel = getCacheModel();
  const row = await CacheModel.findById(modelName).lean();
  const value = row
    ? { id: row.id || null, hash: row.hash || null, expireTime: row.expireTime || null }
    : { id: null, hash: null, expireTime: null };

  memCache.set(modelName, { value, expiresAt: Date.now() + MEM_CACHE_TTL_MS });
  return value;
}

async function createRemoteCache(systemPrompt, modelName, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
  const data = await fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({
      model: `models/${modelName}`,
      contents: [],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      ttl: `${env.GEMINI_CACHE_TTL_SECONDS}s`,
    }),
  }, env.GEMINI_PROXY_TIMEOUT_MS);

  if (!data?.name) {
    throw new AppError('Cache creation failed', 502, 'CACHE_CREATE_FAILED', data);
  }

  return { id: data.name, hash: hashPrompt(systemPrompt), expireTime: data.expireTime || null };
}

export async function ensureGeminiCache(systemPrompt, { modelName = env.GEMINI_MODEL, apiKey = env.GEMINI_API_KEY } = {}) {
  if (!systemPrompt || systemPrompt.length < env.GEMINI_CACHE_MIN_CHARS) {
    return { cache: null, action: 'skipped' };
  }

  const currentHash = hashPrompt(systemPrompt);
  const cache = await hydrateGeminiCachePool(modelName);

  if (cache.id && cache.hash === currentHash) {
    return { cache, action: 'hit' };
  }

  const flightKey = `${modelName}:${currentHash}`;
  if (!inFlightCreation.has(flightKey)) {
    inFlightCreation.set(flightKey, (async () => {
      const created = await createRemoteCache(systemPrompt, modelName, apiKey);
      await persistCache(modelName, created);
      return created;
    })());
  }

  try {
    const created = await inFlightCreation.get(flightKey);
    return { cache: created, action: 'created' };
  } finally {
    inFlightCreation.delete(flightKey);
  }
}

export async function invalidateGeminiCache(modelName = env.GEMINI_MODEL) {
  const empty = { id: null, hash: null, expireTime: null };
  await persistCache(modelName, empty);
  return empty;
}

export async function cleanupGeminiCaches({ apiKey = env.GEMINI_API_KEY, modelName = env.GEMINI_MODEL } = {}) {
  const current = await hydrateGeminiCachePool(modelName);
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
  const data = await fetchJson(listUrl, {}, env.GEMINI_PROXY_TIMEOUT_MS);
  const cachedContents = data?.cachedContents || [];

  let deleted = 0;
  let failed = 0;
  let kept = 0;

  await Promise.all(cachedContents.map(async (item) => {
    if (item.name === current.id) {
      kept += 1;
      return;
    }
    try {
      await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/${item.name}?key=${apiKey}`,
        { method: 'DELETE' },
        env.GEMINI_PROXY_TIMEOUT_MS
      );
      deleted += 1;
    } catch {
      failed += 1;
    }
  }));

  return { deleted, failed, kept, activeId: current.id };
}

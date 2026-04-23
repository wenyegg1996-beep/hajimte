import mongoose from 'mongoose';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';

let connectionPromise = null;
let indexEnsurePromise = null;

const dynamicSchema = new mongoose.Schema({ _id: String }, { strict: false });

export const collectionPolicies = {
  scripts: { read: 'user', write: 'user', queryByUser: true, sort: { time: -1 } },
  knowledge_base: { read: 'user', write: 'user' },
  images: { read: 'user', write: 'user', sort: { time: -1 } },
  templates: { read: 'user', write: 'user' },
  monitoring: { read: 'user', write: 'user', queryByUser: true },
  announcement_logs: { read: 'admin', create: 'user', delete: 'admin', sort: { time: -1 } },
  training_data: { read: 'admin', create: 'user', delete: 'admin', sort: { time: -1 } },
  global_settings: { read: 'user', write: 'user' },
  access_keys: { read: 'admin', write: 'admin' },
  venue_rules: { read: 'user', write: 'user' },
  gemini_cache_pool: { read: 'admin', write: 'admin' },
};

export async function connectToDatabase() {
  if (!env.MONGODB_URI) {
    throw new AppError('Missing MONGODB_URI', 500, 'MISSING_MONGO_URI');
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(env.MONGODB_URI);
  }

  await connectionPromise;
  if (!indexEnsurePromise) {
    indexEnsurePromise = ensureIndexes().catch(() => {});
  }
  await indexEnsurePromise;
  return mongoose.connection;
}

async function ensureIndexes() {
  const db = mongoose.connection.db;
  if (!db) return;

  await Promise.all([
    db.collection('scripts').createIndex({ user: 1, time: -1 }, { background: true }),
    db.collection('monitoring').createIndex({ user: 1, time: -1 }, { background: true }),
    // Collections queried with sort:{time:-1} need this index to avoid full scans
    db.collection('images').createIndex({ time: -1 }, { background: true }),
    db.collection('announcement_logs').createIndex({ time: -1 }, { background: true }),
    db.collection('training_data').createIndex({ time: -1 }, { background: true }),
    // Used in login: findOne({username, active:true})
    db.collection('access_keys').createIndex({ username: 1, active: 1 }, { background: true }),
  ]);
}

export function assertCollectionAllowed(collection) {
  if (!collectionPolicies[collection]) {
    throw new AppError(`Collection ${collection} is not allowed`, 404, 'COLLECTION_NOT_FOUND');
  }
  return collectionPolicies[collection];
}

export function getCollectionModel(collection) {
  return mongoose.models[collection] || mongoose.model(collection, dynamicSchema, collection);
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger.js';
import { connectToDatabase } from './services/db.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.js';
import { createDbRouter } from './routes/db.js';
import { createGeminiRouter } from './routes/gemini.js';
import { createImageRouter } from './routes/images.js';
import { getUploadsDir } from './services/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const distDir = path.join(projectRoot, 'dist');

export async function createServerApp() {
  await connectToDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(pinoHttp({ logger }));

  app.use('/storage', express.static(getUploadsDir()));
  app.use('/api/auth', createAuthRouter());
  app.get('/api/auth/session', requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
  });
  app.use('/api', requireAuth, createImageRouter());
  app.use('/api', requireAuth, createGeminiRouter());
  app.use('/api/db', requireAuth, createDbRouter());

  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

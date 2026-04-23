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
  app.use(cors(env.CORS_ORIGIN ? { origin: env.CORS_ORIGIN } : {}));
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

  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return;
      }

      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(distDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

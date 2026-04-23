import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { cleanupGeminiCaches } from '../services/geminiCacheService.js';
import { proxyGeminiRequest } from '../services/geminiProxyService.js';
import { requireRole } from '../middleware/auth.js';

export function createGeminiRouter() {
  const router = Router();
  const limiter = rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    max: env.API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/gemini', limiter, async (req, res, next) => {
    try {
      await proxyGeminiRequest(req, res);
    } catch (error) {
      next(error);
    }
  });

  router.post('/cleanup-caches', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await cleanupGeminiCaches();
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/update-cache', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await cleanupGeminiCaches();
      res.json({ success: true, mode: 'managed', ...result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

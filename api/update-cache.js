import { connectToDatabase } from '../src/server/services/db.js';
import { cleanupGeminiCaches } from '../src/server/services/geminiCacheService.js';
import { errorHandler } from '../src/server/middleware/errorHandler.js';
import { verifySession } from '../src/server/services/auth.js';
import { AppError } from '../src/server/lib/errors.js';

export default async function handler(req, res) {
  try {
    await connectToDatabase();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) throw new AppError('Missing authorization token', 401, 'MISSING_AUTH');
    req.user = verifySession(token);
    if (req.user.role !== 'admin') throw new AppError('Forbidden', 403, 'FORBIDDEN');
    const result = await cleanupGeminiCaches();
    res.status(200).json({ success: true, mode: 'managed', ...result });
  } catch (error) {
    errorHandler(error, req, res, () => {});
  }
}

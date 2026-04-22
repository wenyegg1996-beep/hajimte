import { connectToDatabase } from '../src/server/services/db.js';
import { proxyGeminiRequest } from '../src/server/services/geminiProxyService.js';
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
    await proxyGeminiRequest(req, res);
  } catch (error) {
    errorHandler(error, req, res, () => {});
  }
}

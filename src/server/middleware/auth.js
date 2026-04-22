import { AppError } from '../lib/errors.js';
import { verifySession } from '../services/auth.js';

export function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      throw new AppError('Missing authorization token', 401, 'MISSING_AUTH');
    }

    req.user = verifySession(token);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
      return;
    }

    if (role === 'admin' && req.user.role !== 'admin') {
      next(new AppError('Forbidden', 403, 'FORBIDDEN'));
      return;
    }

    next();
  };
}

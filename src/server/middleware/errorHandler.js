import { logger } from '../lib/logger.js';
import { toErrorPayload } from '../lib/errors.js';

export function errorHandler(error, req, res, _next) {
  const payload = toErrorPayload(error);
  logger.error({
    err: error,
    path: req.path,
    method: req.method,
    requestId: req.id,
    user: req.user?.username,
  }, 'request_failed');
  res.status(payload.status).json(payload.body);
}

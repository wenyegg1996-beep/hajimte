import jwt from 'jsonwebtoken';
import { Secret, TOTP } from 'otpauth';
import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { getCollectionModel } from './db.js';

export function signSession(user) {
  return jwt.sign(
    { username: user.username, role: user.role || 'user' },
    env.SESSION_SECRET,
    { expiresIn: env.SESSION_EXPIRES_IN }
  );
}

export function verifySession(token) {
  try {
    return jwt.verify(token, env.SESSION_SECRET);
  } catch {
    throw new AppError('Invalid session', 401, 'INVALID_SESSION');
  }
}

export async function resolveLogin(input) {
  if (!input) {
    throw new AppError('Missing login input', 400, 'MISSING_LOGIN_INPUT');
  }

  const AccessKey = getCollectionModel('access_keys');

  // Fast path: exact username match via indexed query
  if (input.length !== 6 || !/^\d+$/.test(input)) {
    const byUsername = await AccessKey.findOne({ username: input, active: true }).lean();
    if (byUsername) {
      return { username: byUsername.username, role: byUsername.role || 'user' };
    }
    throw new AppError('Invalid login', 401, 'INVALID_LOGIN');
  }

  // TOTP path: must check all keys with a secret
  const keys = await AccessKey.find({ active: true }).lean();

  for (const data of keys) {
    if (data.secret) {
      try {
        const totp = new TOTP({
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: Secret.fromBase32(data.secret),
        });
        const delta = totp.validate({ token: input, window: 1 });
        if (delta !== null) {
          return {
            username: data.username || data.note || 'OTP用户',
            role: data.role || 'admin',
          };
        }
      } catch {
        continue;
      }
    }
  }

  throw new AppError('Invalid login', 401, 'INVALID_LOGIN');
}

import { Router } from 'express';
import { resolveLogin, signSession } from '../services/auth.js';

export function createAuthRouter() {
  const router = Router();

  router.post('/login', async (req, res, next) => {
    try {
      const user = await resolveLogin(req.body?.input);
      const token = signSession(user);
      res.json({ success: true, token, username: user.username, role: user.role });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

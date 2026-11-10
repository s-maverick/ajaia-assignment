import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db';
import { clearSession, findUserByEmail, setSession } from '../auth';
import { HttpError } from '../errors';

const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email address') });

export function authRouter(db: Db): Router {
  const router = Router();

  /** Demo accounts shown on the sign-in screen (mocked auth). */
  router.get('/users', async (_req, res) => {
    const { rows } = await db.execute('SELECT id, email, name FROM users ORDER BY name');
    res.json({ users: rows });
  });

  router.get('/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Not signed in.');
    res.json({ user: req.user });
  });

  router.post('/login', async (req, res) => {
    const { email } = loginSchema.parse(req.body);
    const user = await findUserByEmail(db, email);
    if (!user) throw new HttpError(401, 'No demo account with that email.');
    setSession(req, res, user.id);
    res.json({ user });
  });

  router.post('/logout', (_req, res) => {
    clearSession(res);
    res.status(204).end();
  });

  return router;
}

import type { Request, RequestHandler, Response } from 'express';
import type { Db } from './db';
import { HttpError } from './errors';

/**
 * Mocked authentication: users pick a seeded account and we store their id in a
 * signed, httpOnly cookie. There are no passwords - this is deliberately scoped
 * so reviewers can switch between users quickly to test sharing.
 */
export const SESSION_COOKIE = 'ajaia_session';

export interface User {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function setSession(req: Request, res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, userId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    // Secure whenever the request arrived over HTTPS (Render terminates TLS; 'trust proxy' is set).
    secure: req.secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

export async function findUserById(db: Db, id: string): Promise<User | null> {
  const { rows } = await db.execute({ sql: 'SELECT id, email, name FROM users WHERE id = ?', args: [id] });
  return rows[0] ? (rows[0] as unknown as User) : null;
}

export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const { rows } = await db.execute({
    sql: 'SELECT id, email, name FROM users WHERE email = ? COLLATE NOCASE',
    args: [email.trim()],
  });
  return rows[0] ? (rows[0] as unknown as User) : null;
}

/** Resolves the signed session cookie into req.user (if valid). Never rejects. */
export function loadUser(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.signedCookies?.[SESSION_COOKIE];
    if (typeof userId === 'string') {
      req.user = (await findUserById(db, userId)) ?? undefined;
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  next();
};

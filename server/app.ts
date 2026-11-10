import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Db } from './db';
import { loadUser, requireUser } from './auth';
import { errorHandler, HttpError } from './errors';
import { authRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';

export interface AppOptions {
  db: Db;
  sessionSecret: string;
  /** Directory containing the built frontend. Served with SPA fallback when present. */
  staticDir?: string;
}

export function createApp({ db, sessionSecret, staticDir }: AppOptions) {
  const app = express();
  app.set('trust proxy', 1); // behind Render's TLS-terminating proxy
  app.disable('x-powered-by');

  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser(sessionSecret));
  app.use(loadUser(db));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter(db));
  app.use('/api/documents', requireUser, documentsRouter(db));
  app.use('/api', () => {
    throw new HttpError(404, 'Not found.');
  });

  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

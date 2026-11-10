import path from 'node:path';
import { createApp } from './app';
import { createDb, DEFAULT_DB_URL, migrate, seed } from './db';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3001);

const sessionSecret = process.env.SESSION_SECRET ?? (isProduction ? undefined : 'dev-only-secret');
if (!sessionSecret) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
const db = createDb(dbUrl);
await migrate(db);
await seed(db);

const app = createApp({
  db,
  sessionSecret,
  staticDir: isProduction ? path.resolve(import.meta.dirname, '../dist') : undefined,
});

app.listen(port, () => {
  const where = dbUrl.startsWith('file:') ? `local SQLite (${dbUrl})` : 'remote libSQL database';
  console.log(`Ajaia Docs API listening on http://localhost:${port} using ${where}`);
});

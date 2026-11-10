import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app';
import { createDb, migrate, seed } from '../server/db';

/** Fresh app + throwaway SQLite file per test file, so tests never share state. */
export async function setupApp() {
  const file = path.join(os.tmpdir(), `ajaia-test-${randomUUID()}.db`);
  const db = createDb(`file:${file}`);
  await migrate(db);
  await seed(db);
  const app = createApp({ db, sessionSecret: 'test-secret' });

  const signIn = async (email: string) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email }).expect(200);
    return agent;
  };

  const cleanup = () => {
    db.close();
    fs.rmSync(file, { force: true });
  };

  return { app, db, signIn, cleanup };
}

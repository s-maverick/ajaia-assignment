import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';

export type Db = Client;

export const DEFAULT_DB_URL = 'file:data/ajaia-docs.db';

/**
 * Creates a libSQL client. Locally this is a plain SQLite file; in production it
 * can point at a hosted libSQL database (e.g. Turso) with the same code path.
 */
export function createDb(
  url: string = process.env.DATABASE_URL || DEFAULT_DB_URL,
  authToken: string | undefined = process.env.DATABASE_AUTH_TOKEN || undefined,
): Db {
  if (url.startsWith('file:')) {
    fs.mkdirSync(path.dirname(path.resolve(url.slice('file:'.length))), { recursive: true });
  }
  return createClient({ url, authToken });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id    TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id             TEXT PRIMARY KEY,
     owner_id       TEXT NOT NULL REFERENCES users(id),
     title          TEXT NOT NULL,
     content_html   TEXT NOT NULL DEFAULT '',
     version        INTEGER NOT NULL DEFAULT 1,
     last_edited_by TEXT REFERENCES users(id),
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id)`,
  `CREATE TABLE IF NOT EXISTS document_shares (
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     user_id     TEXT NOT NULL REFERENCES users(id),
     role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
     created_at  TEXT NOT NULL,
     PRIMARY KEY (document_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id)`,
];

export const SEED_USERS = [
  { id: 'user-alice', email: 'alice@ajaia.test', name: 'Alice Chen' },
  { id: 'user-bob', email: 'bob@ajaia.test', name: 'Bob Martinez' },
  { id: 'user-carol', email: 'carol@ajaia.test', name: 'Carol Okafor' },
] as const;

const WELCOME_HTML = `
<h1>Welcome to Ajaia Docs</h1>
<p>This is a <strong>lightweight collaborative editor</strong>. It is owned by <em>Alice</em> and shared with Bob (editor) and Carol (viewer), so you can try the sharing flow straight away.</p>
<h2>Things to try</h2>
<ul>
  <li><p>Format text with <strong>bold</strong>, <em>italic</em>, <u>underline</u>, headings and lists.</p></li>
  <li><p>Rename the document by editing the title at the top.</p></li>
  <li><p>Import a <code>.txt</code>, <code>.md</code> or <code>.docx</code> file from the dashboard.</p></li>
  <li><p>Share a document with another seeded user and sign in as them to see it under <em>Shared with me</em>.</p></li>
</ul>
<h2>Roles</h2>
<ol>
  <li><p><strong>Owner</strong>: edit, rename, share, delete.</p></li>
  <li><p><strong>Editor</strong>: edit and rename.</p></li>
  <li><p><strong>Viewer</strong>: read only.</p></li>
</ol>
<blockquote><p>Changes save automatically. Refresh the page and they will still be here.</p></blockquote>
`.trim();

export async function migrate(db: Db): Promise<void> {
  await db.batch(SCHEMA, 'write');
}

/** Idempotent: always ensures demo users exist; seeds a welcome doc only into an empty DB. */
export async function seed(db: Db): Promise<void> {
  await db.batch(
    SEED_USERS.map((u) => ({
      sql: 'INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)',
      args: [u.id, u.email, u.name],
    })),
    'write',
  );

  const { rows } = await db.execute('SELECT COUNT(*) AS n FROM documents');
  if (Number(rows[0].n) > 0) return;

  const now = new Date().toISOString();
  const docId = randomUUID();
  await db.batch(
    [
      {
        sql: `INSERT INTO documents (id, owner_id, title, content_html, last_edited_by, created_at, updated_at)
              VALUES (?, 'user-alice', 'Welcome to Ajaia Docs', ?, 'user-alice', ?, ?)`,
        args: [docId, WELCOME_HTML, now, now],
      },
      {
        sql: `INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, 'user-bob', 'editor', ?)`,
        args: [docId, now],
      },
      {
        sql: `INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, 'user-carol', 'viewer', ?)`,
        args: [docId, now],
      },
    ],
    'write',
  );
}

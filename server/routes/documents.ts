import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Db } from '../db';
import { findUserByEmail, type User } from '../auth';
import { requireRole } from '../access';
import { HttpError } from '../errors';
import { sanitizeDocHtml } from '../html';
import { convertUpload, MAX_UPLOAD_BYTES } from '../importers';

const MAX_CONTENT_CHARS = 2_000_000;

const titleSchema = z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title must be 200 characters or fewer');

const createSchema = z.object({ title: titleSchema.optional() });

const updateSchema = z
  .object({
    title: titleSchema.optional(),
    contentHtml: z.string().max(MAX_CONTENT_CHARS, 'Document is too large').optional(),
    baseVersion: z.number().int().positive().optional(),
  })
  .refine((b) => b.title !== undefined || b.contentHtml !== undefined, 'Nothing to update')
  .refine((b) => b.contentHtml === undefined || b.baseVersion !== undefined, 'baseVersion is required when saving content');

const shareSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  role: z.enum(['viewer', 'editor']),
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

const currentUser = (req: Request): User => req.user!;
const docId = (req: Request): string => String(req.params.id);

async function loadDocument(db: Db, id: string) {
  const { rows } = await db.execute({
    sql: `SELECT d.id, d.title, d.content_html, d.version, d.created_at, d.updated_at,
                 o.id AS owner_id, o.name AS owner_name, o.email AS owner_email,
                 e.name AS last_edited_by_name
            FROM documents d
            JOIN users o ON o.id = d.owner_id
            LEFT JOIN users e ON e.id = d.last_edited_by
           WHERE d.id = ?`,
    args: [id],
  });
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Document not found.');
  return {
    id: String(r.id),
    title: String(r.title),
    contentHtml: String(r.content_html),
    version: Number(r.version),
    owner: { id: String(r.owner_id), name: String(r.owner_name), email: String(r.owner_email) },
    lastEditedBy: r.last_edited_by_name ? String(r.last_edited_by_name) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

async function loadShares(db: Db, id: string) {
  const { rows } = await db.execute({
    sql: `SELECT u.id AS user_id, u.name, u.email, s.role
            FROM document_shares s JOIN users u ON u.id = s.user_id
           WHERE s.document_id = ? ORDER BY u.name`,
    args: [id],
  });
  return rows.map((r) => ({ userId: String(r.user_id), name: String(r.name), email: String(r.email), role: String(r.role) }));
}

async function insertDocument(db: Db, ownerId: string, title: string, html: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO documents (id, owner_id, title, content_html, last_edited_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, ownerId, title, html, ownerId, now, now],
  });
  return id;
}

export function documentsRouter(db: Db): Router {
  const router = Router();

  /** Dashboard: documents I own and documents shared with me, kept visibly separate. */
  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const [owned, shared] = await Promise.all([
      db.execute({
        sql: `SELECT d.id, d.title, d.updated_at,
                     (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS share_count
                FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`,
        args: [user.id],
      }),
      db.execute({
        sql: `SELECT d.id, d.title, d.updated_at, s.role, o.name AS owner_name, o.email AS owner_email
                FROM document_shares s
                JOIN documents d ON d.id = s.document_id
                JOIN users o ON o.id = d.owner_id
               WHERE s.user_id = ? ORDER BY d.updated_at DESC`,
        args: [user.id],
      }),
    ]);
    res.json({
      owned: owned.rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        updatedAt: String(r.updated_at),
        shareCount: Number(r.share_count),
        role: 'owner',
      })),
      shared: shared.rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        updatedAt: String(r.updated_at),
        role: String(r.role),
        owner: { name: String(r.owner_name), email: String(r.owner_email) },
      })),
    });
  });

  router.post('/', async (req, res) => {
    const { title } = createSchema.parse(req.body ?? {});
    const id = await insertDocument(db, currentUser(req).id, title ?? 'Untitled document', '');
    res.status(201).json({ document: await loadDocument(db, id), role: 'owner' });
  });

  /** Upload a .txt/.md/.docx file and turn it into a new editable document. */
  router.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a file to upload (field name "file").');
    const { title, html } = await convertUpload(req.file.originalname, req.file.buffer);
    const id = await insertDocument(db, currentUser(req).id, title, html);
    res.status(201).json({ document: await loadDocument(db, id), role: 'owner' });
  });

  router.get('/:id', async (req, res) => {
    const role = await requireRole(db, docId(req), currentUser(req).id, 'viewer');
    const [document, shares] = await Promise.all([loadDocument(db, docId(req)), loadShares(db, docId(req))]);
    res.json({ document, role, shares });
  });

  /**
   * Rename and/or save content. Content saves use optimistic concurrency: the
   * client sends the version it last loaded, and the update only applies if
   * nobody else saved in between. Otherwise we return 409 so the client can
   * let the user choose instead of silently overwriting a collaborator.
   */
  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    await requireRole(db, docId(req), user.id, 'editor');
    const body = updateSchema.parse(req.body);
    const now = new Date().toISOString();

    if (body.contentHtml !== undefined) {
      const result = await db.execute({
        sql: `UPDATE documents SET content_html = ?, version = version + 1, last_edited_by = ?, updated_at = ?
               WHERE id = ? AND version = ?`,
        args: [sanitizeDocHtml(body.contentHtml), user.id, now, docId(req), body.baseVersion!],
      });
      if (result.rowsAffected === 0) {
        const latest = await loadDocument(db, docId(req));
        throw new HttpError(409, 'This document was changed by someone else since you opened it.', {
          currentVersion: latest.version,
          lastEditedBy: latest.lastEditedBy,
        });
      }
    }
    if (body.title !== undefined) {
      await db.execute({
        sql: 'UPDATE documents SET title = ?, updated_at = ? WHERE id = ?',
        args: [body.title, now, docId(req)],
      });
    }
    res.json({ document: await loadDocument(db, docId(req)) });
  });

  router.delete('/:id', async (req, res) => {
    await requireRole(db, docId(req), currentUser(req).id, 'owner');
    await db.batch(
      [
        { sql: 'DELETE FROM document_shares WHERE document_id = ?', args: [docId(req)] },
        { sql: 'DELETE FROM documents WHERE id = ?', args: [docId(req)] },
      ],
      'write',
    );
    res.status(204).end();
  });

  /** Grant or change access for another user (owner only). */
  router.put('/:id/shares', async (req, res) => {
    const user = currentUser(req);
    await requireRole(db, docId(req), user.id, 'owner');
    const { email, role } = shareSchema.parse(req.body);
    const target = await findUserByEmail(db, email);
    if (!target) throw new HttpError(404, `No user found with email ${email}.`);
    if (target.id === user.id) throw new HttpError(400, 'You already own this document.');
    await db.execute({
      sql: `INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
      args: [docId(req), target.id, role, new Date().toISOString()],
    });
    res.json({ shares: await loadShares(db, docId(req)) });
  });

  router.delete('/:id/shares/:userId', async (req, res) => {
    await requireRole(db, docId(req), currentUser(req).id, 'owner');
    await db.execute({
      sql: 'DELETE FROM document_shares WHERE document_id = ? AND user_id = ?',
      args: [docId(req), String(req.params.userId)],
    });
    res.json({ shares: await loadShares(db, docId(req)) });
  });

  return router;
}

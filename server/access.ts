import type { Db } from './db';
import { HttpError } from './errors';

export type Role = 'owner' | 'editor' | 'viewer';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/** Returns the caller's role on a document, or null if they have no access (or it doesn't exist). */
export async function getRole(db: Db, documentId: string, userId: string): Promise<Role | null> {
  const { rows } = await db.execute({
    sql: `SELECT CASE WHEN d.owner_id = ? THEN 'owner' ELSE s.role END AS role
            FROM documents d
            LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = ?
           WHERE d.id = ?`,
    args: [userId, userId, documentId],
  });
  return (rows[0]?.role as Role | null | undefined) ?? null;
}

/**
 * Single choke point for document authorization.
 * - No access at all -> 404, so we don't leak which document ids exist.
 * - Some access but not enough -> 403 with a clear message.
 */
export async function requireRole(db: Db, documentId: string, userId: string, minimum: Role): Promise<Role> {
  const role = await getRole(db, documentId, userId);
  if (!role) throw new HttpError(404, 'Document not found.');
  if (RANK[role] < RANK[minimum]) {
    const action = minimum === 'owner' ? 'Only the owner can do that.' : 'You have view-only access to this document.';
    throw new HttpError(403, action);
  }
  return role;
}

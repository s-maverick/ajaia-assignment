import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupApp } from './helpers';

let ctx: Awaited<ReturnType<typeof setupApp>>;
type Agent = Awaited<ReturnType<typeof ctx.signIn>>;
let alice: Agent;
let bob: Agent;
let carol: Agent;

beforeAll(async () => {
  ctx = await setupApp();
  [alice, bob, carol] = await Promise.all([
    ctx.signIn('alice@ajaia.test'),
    ctx.signIn('bob@ajaia.test'),
    ctx.signIn('carol@ajaia.test'),
  ]);
});
afterAll(() => ctx.cleanup());

async function createDoc(agent: Agent, title = 'Plan') {
  const res = await agent.post('/api/documents').send({ title }).expect(201);
  return res.body.document as { id: string; version: number };
}

describe('auth', () => {
  it('rejects unauthenticated access to documents', async () => {
    await request(ctx.app).get('/api/documents').expect(401);
  });

  it('rejects unknown and malformed logins', async () => {
    await request(ctx.app).post('/api/auth/login').send({ email: 'nobody@ajaia.test' }).expect(401);
    await request(ctx.app).post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
  });

  it('issues an httpOnly session cookie, Secure when behind an HTTPS proxy', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: 'alice@ajaia.test' })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('ignores a tampered session cookie', async () => {
    await request(ctx.app).get('/api/auth/me').set('Cookie', 'ajaia_session=user-alice').expect(401);
  });
});

describe('document lifecycle', () => {
  it('creates, renames, saves and reopens a document with formatting intact', async () => {
    const doc = await createDoc(alice, 'Draft');

    await alice.patch(`/api/documents/${doc.id}`).send({ title: '  Q3 Roadmap  ' }).expect(200);
    const html = '<h1>Goals</h1><p><strong>Bold</strong> <em>italic</em> <u>underline</u></p><ul><li><p>One</p></li></ul><ol><li><p>First</p></li></ol>';
    const saved = await alice
      .patch(`/api/documents/${doc.id}`)
      .send({ contentHtml: html, baseVersion: doc.version })
      .expect(200);
    expect(saved.body.document.version).toBe(doc.version + 1);

    const reopened = await alice.get(`/api/documents/${doc.id}`).expect(200);
    expect(reopened.body.document.title).toBe('Q3 Roadmap');
    expect(reopened.body.document.contentHtml).toBe(html);
    expect(reopened.body.role).toBe('owner');
  });

  it('strips dangerous markup before persisting', async () => {
    const doc = await createDoc(alice);
    await alice
      .patch(`/api/documents/${doc.id}`)
      .send({
        contentHtml: '<p onclick="steal()">Hi<script>alert(1)</script> <a href="javascript:alert(1)">x</a></p>',
        baseVersion: doc.version,
      })
      .expect(200);
    const { body } = await alice.get(`/api/documents/${doc.id}`).expect(200);
    expect(body.document.contentHtml).not.toMatch(/script|onclick|javascript:/);
    expect(body.document.contentHtml).toContain('Hi');
  });

  it('validates input', async () => {
    const doc = await createDoc(alice);
    await alice.patch(`/api/documents/${doc.id}`).send({ title: '   ' }).expect(400);
    await alice.patch(`/api/documents/${doc.id}`).send({}).expect(400);
    await alice.patch(`/api/documents/${doc.id}`).send({ contentHtml: '<p>x</p>' }).expect(400); // missing baseVersion
  });

  it('rejects a stale save with 409 instead of overwriting a collaborator', async () => {
    const doc = await createDoc(alice);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(200);

    await bob.patch(`/api/documents/${doc.id}`).send({ contentHtml: '<p>Bob was here</p>', baseVersion: doc.version }).expect(200);
    const stale = await alice
      .patch(`/api/documents/${doc.id}`)
      .send({ contentHtml: '<p>Alice overwrites</p>', baseVersion: doc.version })
      .expect(409);
    expect(stale.body.currentVersion).toBe(doc.version + 1);
    expect(stale.body.lastEditedBy).toBe('Bob Martinez');

    const { body } = await alice.get(`/api/documents/${doc.id}`);
    expect(body.document.contentHtml).toBe('<p>Bob was here</p>');
  });
});

describe('sharing and access control', () => {
  it('keeps documents private until shared', async () => {
    const doc = await createDoc(alice, 'Private');
    await bob.get(`/api/documents/${doc.id}`).expect(404);
    const list = await bob.get('/api/documents').expect(200);
    expect(list.body.shared.map((d: { id: string }) => d.id)).not.toContain(doc.id);
  });

  it('separates owned and shared documents and enforces viewer vs editor roles', async () => {
    const doc = await createDoc(alice, 'Shared plan');

    // Viewer: can read, cannot edit.
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'BOB@ajaia.test', role: 'viewer' }).expect(200);
    const bobList = await bob.get('/api/documents').expect(200);
    const sharedEntry = bobList.body.shared.find((d: { id: string }) => d.id === doc.id);
    expect(sharedEntry).toMatchObject({ role: 'viewer', owner: { name: 'Alice Chen' } });
    expect(bobList.body.owned.map((d: { id: string }) => d.id)).not.toContain(doc.id);

    const aliceList = await alice.get('/api/documents').expect(200);
    expect(aliceList.body.owned.find((d: { id: string }) => d.id === doc.id)).toMatchObject({ shareCount: 1 });

    await bob.get(`/api/documents/${doc.id}`).expect(200);
    await bob.patch(`/api/documents/${doc.id}`).send({ title: 'Hijacked' }).expect(403);

    // Upgrade to editor: can now edit.
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(200);
    await bob.patch(`/api/documents/${doc.id}`).send({ contentHtml: '<p>edited by bob</p>', baseVersion: doc.version }).expect(200);

    // Only the owner can manage sharing or delete.
    await bob.put(`/api/documents/${doc.id}/shares`).send({ email: 'carol@ajaia.test', role: 'editor' }).expect(403);
    await bob.delete(`/api/documents/${doc.id}`).expect(403);

    // Revoking access removes it immediately.
    const bobId = (await bob.get('/api/auth/me')).body.user.id;
    await alice.delete(`/api/documents/${doc.id}/shares/${bobId}`).expect(200);
    await bob.get(`/api/documents/${doc.id}`).expect(404);
    await carol.get(`/api/documents/${doc.id}`).expect(404);
  });

  it('rejects sharing with unknown users or yourself', async () => {
    const doc = await createDoc(alice);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'ghost@ajaia.test', role: 'viewer' }).expect(404);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'alice@ajaia.test', role: 'viewer' }).expect(400);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'admin' }).expect(400);
  });

  it('deletes a document and its shares', async () => {
    const doc = await createDoc(alice);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'carol@ajaia.test', role: 'viewer' }).expect(200);
    await alice.delete(`/api/documents/${doc.id}`).expect(204);
    await alice.get(`/api/documents/${doc.id}`).expect(404);
    await carol.get(`/api/documents/${doc.id}`).expect(404);
  });
});

describe('file import', () => {
  it('turns an uploaded markdown file into a new owned document', async () => {
    const res = await alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('# Meeting notes\n\n- **Ship** it\n- Test it\n'), 'meeting_notes.md')
      .expect(201);
    expect(res.body.document.title).toBe('meeting notes');
    expect(res.body.document.contentHtml).toContain('<h1>Meeting notes</h1>');
    expect(res.body.document.contentHtml).toContain('<strong>Ship</strong>');

    const list = await alice.get('/api/documents');
    expect(list.body.owned.map((d: { id: string }) => d.id)).toContain(res.body.document.id);
  });

  it('rejects unsupported and missing files with a clear error', async () => {
    const bad = await alice.post('/api/documents/import').attach('file', Buffer.from('%PDF-1.4'), 'report.pdf').expect(415);
    expect(bad.body.error).toMatch(/\.txt, \.md or \.docx/);
    await alice.post('/api/documents/import').expect(400);
  });
});

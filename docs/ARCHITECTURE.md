# Architecture note

## Goal and scope decision

The brief asks for a Google-Docs-inspired editor in a short timebox. I chose to go **deep on the core document loop** and treat everything else as out of scope. The core loop:

1. Create
2. Edit with real formatting
3. Save reliably
4. Share with clear permissions
5. Reopen

A smaller product that never loses or leaks a document beats a wider one with shaky basics.

| Prioritized (depth) | Deliberately cut |
|---|---|
| Reliable autosave with visible status, retry, and unsaved-changes warning | Real-time co-editing (CRDT/OT), live cursors |
| Version-checked saves so concurrent editors can't silently clobber each other | Comments, suggestions, version history UI |
| Owner / editor / viewer roles enforced server-side, one authorization check | Real auth (passwords/SSO), teams, link sharing |
| Server-side sanitization of all stored and imported HTML | Images, tables, fonts, colors, page layout |
| `.txt`/`.md`/`.docx` import that keeps structure | Import into an existing doc, export |
| Tests at the API layer plus a browser smoke test | Search, folders, pagination, rate limiting |

## System shape

```
Browser (React + TipTap)                    Node (Express 5)                       libSQL
┌──────────────────────────┐   JSON/      ┌──────────────────────────────┐      ┌──────────────┐
│ Login · Dashboard · Editor│  multipart   │ cookie session → req.user    │ SQL  │ users        │
│ useAutosave (debounced,   │ ───────────▶ │ requireRole(doc, user, min)  │ ───▶ │ documents    │
│  single writer, 409 UI)   │ same origin  │ zod validation · sanitize    │      │ document_    │
│ ShareDialog · Toolbar     │ ◀─────────── │ importers (mammoth, marked)  │      │   shares     │
└──────────────────────────┘              │ serves built SPA in prod     │      └──────────────┘
                                          └──────────────────────────────┘   SQLite file (local)
                                                                              or Turso (prod)
```

**One deployable.** In production, Express serves both `/api/*` and the built React app. That gives one URL for reviewers, no CORS, and a same-site cookie, which keeps the auth story simple. The editor route is lazy-loaded so the dashboard doesn't pay for ProseMirror.

## Key decisions

**1. TipTap (ProseMirror) for editing.** It's schema-driven: the document can only contain node types the schema allows, which gives predictable structure. It comes with keyboard shortcuts, undo history and Markdown-style input rules, so the effort went into product behavior rather than `contenteditable` edge cases.

**2. Store sanitized HTML rather than ProseMirror JSON.** The editor and importers both speak HTML, so one format flows through the whole pipeline (`.docx` → HTML → editor → DB). It's also human-readable in the database and easy to export later.

Every write and every import goes through one `sanitize-html` allowlist that mirrors the editor schema: `p`, `h1–h3`, `strong`, `em`, `u`, `s`, lists, `blockquote`, `code`, `a` (http/https/mailto only). Documents are shared between users, so this blocks stored XSS at the server, not only in the editor. The trade-off is that JSON would be the better base for real-time collaboration (Yjs) later, and switching would be a migration.

**3. Optimistic concurrency instead of real-time collaboration.** Each document has a `version`. A save sends `baseVersion` and runs `UPDATE … WHERE id = ? AND version = ?`. If no row matches, the server returns **409** with who last edited, and the UI offers *Load their version* or *Keep mine*.

On the client, autosave is a single-writer loop: one request in flight at a time, and keystrokes made during a save are picked up by the same loop. That means the client can never race itself into a false conflict.

This gives correct behavior for the realistic "two people edit the same doc" case at a fraction of the cost of CRDTs. Renames don't bump the version, so renaming never conflicts with content edits.

**4. Authorization in one place.** `getRole()` resolves a user's role in one SQL query: owner if `owner_id` matches, otherwise the share's role, otherwise none. Every document route calls `requireRole(doc, user, minimum)`, which ranks `viewer < editor < owner`:

- **No access → 404,** so document ids don't leak.
- **Some access but not enough → 403** with a human-readable reason.

Only owners can share, change roles, revoke or delete. Deleting a document removes its shares in the same batch.

**5. Mocked auth, but done properly.** A seeded user's id goes into an **HMAC-signed, httpOnly, SameSite=Lax** cookie, marked `Secure` when the request came over HTTPS (`trust proxy` is set for Render's TLS proxy). Tampered cookies are ignored, and there's a test for that. Swapping in real auth would only change `/api/auth/login`, because everything downstream depends on `req.user`.

**6. libSQL for persistence.** The same client talks to a local SQLite file in development and tests, and to a hosted Turso database in production with only an env-var change. That matters because free hosts like Render have ephemeral disks. Tests each get a throwaway database file.

**7. Imports happen on the server.** Multer holds the upload in memory, with a 5 MB limit. The file type is checked by extension and, for `.docx`, by its zip signature. `mammoth` converts `.docx` and `marked` converts `.md`; plain text is split into paragraphs. Everything then passes through the same sanitizer. Unsupported or broken files get specific errors: 415, 422, or 400 for an empty file.

## Validation and error handling

- **Validation:** request bodies are checked with `zod`. Titles are 1–200 characters, content is capped at 2 MB, and emails and roles are validated.
- **Errors:** one Express error handler maps `HttpError`, `ZodError`, Multer errors and body-parser errors to consistent `{ error }` JSON. Unexpected errors are logged, and the client gets a generic message.
- **UI states:** the UI shows these errors inline, including share dialog errors, import failures, an empty-title revert, and save failures with *Retry*. It warns before closing a tab with unsaved changes, and shows a friendly page for missing or forbidden documents.

## Testing strategy

- **`npm test` (19 tests):** exercises the real Express app against a real SQLite file through HTTP, using Supertest. It covers:
  - the full sharing matrix
  - 404 vs 403
  - the 409 conflict path
  - sanitization and validation
  - cookie flags
  - all three importers, including a `.docx` built in memory
- **`npm run test:e2e`:** drives the production build in Chrome through the full journey, from creating a doc to the conflict UI and import errors. It also fails on unexpected console errors.

I focused tests on the server because that's where correctness and security live. The client has no unit tests; the e2e run covers its behavior.

## Known limitations

- **No live updates for editors.** Editors don't see other people's changes until they reload or hit a conflict. Viewers refresh when the tab regains focus.
- **Whole-document saves.** Each save sends the full document HTML, which is fine at this scale.
- **Demo-only auth.** Anyone can sign in as any demo user. This is acceptable for a demo and documented.
- **Free-tier cold starts.** The free Render instance sleeps after 15 minutes idle, so the first request can take up to ~1 minute.

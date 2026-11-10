# AI workflow note

## Tools
- **Claude Code** (CLI) with **Claude Sonnet 5.5** on the **medium** effort setting, used as a pair-programmer.

## Where AI sped things up
- Scaffolding the full stack: Express API, React + TipTap editor, sharing UI.
- Library glue: `.docx`/`.md` import (mammoth, marked) and the HTML sanitizer allowlist.
- Writing the API tests and a browser end-to-end test.

## What I changed or rejected
- **Session cookie:** AI set `Secure` based on `NODE_ENV`, which broke login on local HTTP. I changed it to `req.secure`.
- **File type check:** Node treats `.md` as having no extension, which a test caught. I replaced the check with an explicit helper.
- **Conflict banner:** it could scroll off-screen, which I spotted in screenshots. I made it sticky.
- **Bundle size:** I lazy-loaded the editor to cut the initial bundle (687 KB → about 270 KB).
- **Rejected:** real-time CRDT editing and real auth, to keep the scope tight.

## How I verified it
- **19 API tests:** permissions, conflicts, sanitization and imports.
- **Type checking.**
- **End-to-end browser test** of the full two-user flow.
- **Manual review** of the screenshots and of the auth and sanitization code.

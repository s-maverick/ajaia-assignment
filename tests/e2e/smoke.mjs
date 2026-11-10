/**
 * Browser smoke test of the full user journey against the production build.
 * Starts its own server on a throwaway SQLite DB, drives the locally installed
 * Google Chrome via playwright-core (no browser download), then shuts down.
 *
 *   npm run test:e2e                       # build + run
 *   SHOTS=docs/screenshots npm run test:e2e   # also refresh README screenshots
 *   CHROME_PATH=/path/to/chrome npm run test:e2e   # if Chrome isn't auto-detected
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 6000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ajaia-e2e-'));

const server = spawn('npx', ['tsx', 'server/index.ts'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), SESSION_SECRET: 'e2e', DATABASE_URL: `file:${TMP}/e2e.db` },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
  server.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
});
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'; // End scrolls the page on macOS
const errors = [];
const log = (...a) => console.log('✔', ...a);
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
);
const newUser = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('text=Pick a demo account');
  if (name === 'alice') await shot(page, '01-login');
  await page.click(`button:has-text("${name === 'alice' ? 'Alice Chen' : 'Bob Martinez'}")`);
  await page.waitForSelector('text=My documents');
  return page;
};
const saved = (page) => page.waitForSelector('text=All changes saved', { timeout: 5000 });

try {
  // --- Alice creates and formats a document
  const alice = await newUser('alice');
  await alice.waitForSelector('text=Welcome to Ajaia Docs');
  await alice.click('button:has-text("New document")');
  const title = alice.getByLabel('Document title');
  await title.waitFor();
  await title.fill('Launch plan');
  await title.press('Enter'); // commits title, moves focus into body
  await alice.selectOption('select[aria-label="Text style"]', 'h1');
  await alice.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
  await alice.keyboard.type('Q4 Launch');
  await alice.keyboard.press('Enter');
  await alice.keyboard.type('This is ');
  await alice.click('button[aria-label^="Bold"]');
  await alice.keyboard.type('important');
  await alice.click('button[aria-label^="Bold"]');
  await alice.keyboard.type(' and ');
  await alice.keyboard.press(`${MOD}+i`);
  await alice.keyboard.type('nuanced');
  await alice.keyboard.press(`${MOD}+i`);
  await alice.keyboard.type(' and ');
  await alice.click('button[aria-label^="Underline"]');
  await alice.keyboard.type('underlined');
  await alice.click('button[aria-label^="Underline"]');
  await alice.keyboard.press('Enter');
  await alice.click('button[aria-label^="Bulleted list"]');
  await alice.keyboard.type('Write spec');
  await alice.keyboard.press('Enter');
  await alice.keyboard.type('Ship it');
  await alice.keyboard.press('Enter');
  await alice.keyboard.press('Enter'); // leave list
  await alice.click('button[aria-label^="Numbered list"]');
  await alice.keyboard.type('First step');
  await saved(alice);
  await shot(alice, '03-editor');
  log('created + formatted doc, autosaved');

  // --- Persistence across refresh
  await alice.reload();
  await alice.waitForSelector('.doc-content h1');
  const html = await alice.innerHTML('.doc-content');
  for (const frag of ['<h1>Q4 Launch</h1>', '<strong>important</strong>', '<em>nuanced</em>', '<u>underlined</u>', '<ul>', '<ol>']) {
    if (!html.includes(frag)) throw new Error(`after reload, missing ${frag}: ${html}`);
  }
  if ((await alice.getByLabel('Document title').inputValue()) !== 'Launch plan') throw new Error('title not persisted');
  log('content, formatting and title persist after reload');

  // --- Share with Bob as viewer
  await alice.click('button:has-text("Share")');
  await alice.fill('input[aria-label="Email address"]', 'bob@ajaia.test');
  await alice.selectOption('.share-form select', 'viewer');
  await alice.click('.share-form button[type=submit]');
  await alice.waitForSelector('text=Shared with bob@ajaia.test');
  await shot(alice, '04-share-dialog');
  // invalid share shows an error
  await alice.fill('input[aria-label="Email address"]', 'ghost@ajaia.test');
  await alice.click('.share-form button[type=submit]');
  await alice.waitForSelector('.form-error:has-text("No user found")');
  await alice.click('button:has-text("Done")');
  log('shared with Bob (viewer); unknown email rejected with message');

  // --- Bob sees it under Shared with me, read-only
  const bob = await newUser('bob');
  const row = bob.locator('section:has(h2:has-text("Shared with me")) .doc-row', { hasText: 'Launch plan' });
  await row.waitFor();
  if (!(await row.textContent()).includes('View only')) throw new Error('expected View only badge');
  await shot(bob, '05-bob-dashboard');
  await row.locator('a').click();
  await bob.waitForSelector('text=You have view-only access');
  if (await bob.locator('.toolbar').count()) throw new Error('viewer should not see toolbar');
  if ((await bob.getAttribute('.doc-content', 'contenteditable')) !== 'false') throw new Error('viewer editor should be read-only');
  await shot(bob, '06-bob-viewer');
  log('Bob sees doc under "Shared with me" as View only; editor is read-only');

  // --- Upgrade Bob to editor, both edit -> conflict for the stale one
  await alice.click('button:has-text("Share")');
  await alice.selectOption('select[aria-label="Access for Bob Martinez"]', 'editor');
  await alice.waitForSelector("text=Updated Bob Martinez's access.");
  await alice.click('button:has-text("Done")');
  await bob.reload();
  await bob.waitForSelector('.toolbar');
  await bob.click('.doc-content');
  await bob.keyboard.press(MOD === "Meta" ? "Meta+ArrowDown" : "Control+End"); // end of document
  await bob.keyboard.type(' (Bob edited)');
  await saved(bob);
  log('Bob upgraded to editor and saved an edit');

  await alice.click('.doc-content h1');
  await alice.keyboard.press(LINE_END);
  await alice.keyboard.type('!!');
  await alice.waitForSelector('text=saved changes to this document while you were editing');
  await shot(alice, '07-conflict');
  await alice.click('button:has-text("Load their version")');
  await alice.waitForSelector('text=All changes saved');
  if (!(await alice.innerHTML('.doc-content')).includes('Bob edited')) throw new Error('reload did not bring in Bob edit');
  log('stale save by Alice -> conflict banner -> "Load their version" pulls Bob\'s edit');

  // --- Import a file from the dashboard
  await alice.goto(BASE);
  await alice.waitForSelector('text=My documents');
  const md = path.join(TMP, 'meeting_notes.md');
  fs.writeFileSync(md, '# Meeting notes\n\nDecisions made **today**:\n\n1. Ship v1\n2. Gather feedback\n');
  await alice.setInputFiles('input[type=file]', md);
  await alice.waitForSelector('.doc-content h1:has-text("Meeting notes")');
  if ((await alice.getByLabel('Document title').inputValue()) !== 'meeting notes') throw new Error('import title');
  log('imported .md -> new editable document');
  // unsupported type shows a friendly error
  await alice.goto(BASE);
  await alice.waitForSelector('text=My documents');
  const pdf = path.join(TMP, 'bad.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4');
  await alice.setInputFiles('input[type=file]', pdf);
  await alice.waitForSelector('.banner-error:has-text("Unsupported file type")');
  await alice.click('button:has-text("Dismiss")');
  await shot(alice, '02-dashboard');
  log('unsupported upload shows a clear error');

  // --- Direct URL to a doc Bob can't access
  const privateId = (await alice.locator('.doc-row a', { hasText: 'meeting notes' }).getAttribute('href'));
  await bob.goto(BASE + privateId);
  await bob.waitForSelector("text=don't have access");
  log('non-shared doc URL shows a friendly no-access page');
} catch (e) {
  console.error('✘', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  // Expected HTTP errors (401 before login, 409 conflict, 415 bad upload...) show up as
  // "Failed to load resource"; anything else is an unexpected client-side error.
  const unexpected = errors.filter((e) => !e.includes('Failed to load resource'));
  if (unexpected.length) {
    console.error('Unexpected console errors:\n' + unexpected.join('\n'));
    process.exitCode = 1;
  } else console.log('No unexpected console errors.');
}

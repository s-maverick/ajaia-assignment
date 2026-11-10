import path from 'node:path';
import mammoth from 'mammoth';
import { marked } from 'marked';
import { HttpError } from './errors';
import { sanitizeDocHtml, textToHtml } from './html';

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ImportedDocument {
  title: string;
  html: string;
}

/** Like path.extname, but also treats ".md" as an extension (Node sees it as a dotfile). */
export function extensionOf(filename: string): string {
  return (path.basename(filename).match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
}

export function titleFromFilename(filename: string): string {
  const name = path.basename(filename);
  const base = name.slice(0, name.length - extensionOf(name).length).replace(/[_-]+/g, ' ').trim();
  return (base || 'Imported document').slice(0, 200);
}

/**
 * Converts an uploaded file into sanitized editor HTML.
 * Supported: .txt (paragraphs), .md (GitHub-flavoured Markdown), .docx (via mammoth).
 */
export async function convertUpload(filename: string, buffer: Buffer): Promise<ImportedDocument> {
  const ext = extensionOf(filename);
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new HttpError(415, `Unsupported file type "${ext || 'unknown'}". Upload a .txt, .md or .docx file.`);
  }
  if (buffer.length === 0) throw new HttpError(400, 'The uploaded file is empty.');

  let html: string;
  if (ext === '.docx') {
    // .docx files are zip archives; reject anything else early with a clear message.
    if (buffer.subarray(0, 2).toString('latin1') !== 'PK') {
      throw new HttpError(422, 'This does not look like a valid .docx file.');
    }
    try {
      const result = await mammoth.convertToHtml({ buffer }, { styleMap: ['u => u'] });
      html = result.value;
    } catch {
      throw new HttpError(422, 'Could not read this .docx file. It may be corrupted or password protected.');
    }
  } else {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    html = ext === '.txt' ? textToHtml(text) : await marked.parse(text, { gfm: true });
  }

  const clean = sanitizeDocHtml(html);
  if (!clean) throw new HttpError(422, 'No readable text was found in this file.');
  return { title: titleFromFilename(filename), html: clean };
}

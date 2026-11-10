import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...err.details });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join('.');
    res.status(400).json({ error: field ? `${field}: ${first.message}` : (first?.message ?? 'Invalid request') });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message;
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Document is too large to save.' });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export interface Conflict {
  currentVersion: number;
  lastEditedBy: string | null;
}

const DEBOUNCE_MS = 800;

/**
 * Debounced autosave with a single writer:
 * - edits mark the doc dirty and schedule a save;
 * - only one request is in flight at a time, and anything typed meanwhile is
 *   picked up by the same loop (so we never race ourselves into a 409);
 * - a 409 from the server stops saving and surfaces a conflict for the user.
 */
export function useAutosave(documentId: string, initialVersion: number) {
  const versionRef = useRef(initialVersion);
  const pendingRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (savingRef.current) return; // the running loop will pick up pending changes
    savingRef.current = true;
    let failed = false;
    try {
      while (pendingRef.current !== null && !conflictRef.current) {
        const html = pendingRef.current;
        pendingRef.current = null;
        setStatus('saving');
        try {
          const { document } = await api.saveContent(documentId, html, versionRef.current);
          versionRef.current = document.version;
          setSavedAt(new Date());
          setError(null);
        } catch (err) {
          pendingRef.current ??= html; // keep the unsaved content for a retry
          failed = true;
          if (err instanceof ApiError && err.status === 409) {
            conflictRef.current = true;
            setConflict({
              currentVersion: Number(err.body.currentVersion),
              lastEditedBy: (err.body.lastEditedBy as string | null) ?? null,
            });
            setStatus('conflict');
          } else {
            setError((err as Error).message);
            setStatus('error');
          }
          break;
        }
      }
      if (!failed) setStatus(pendingRef.current === null ? 'saved' : 'unsaved');
    } finally {
      savingRef.current = false;
    }
  }, [documentId]);

  const markDirty = useCallback(
    (html: string) => {
      pendingRef.current = html;
      if (conflictRef.current) return;
      setStatus((s) => (s === 'saving' ? s : 'unsaved'));
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  /** Conflict resolution: keep my version and save it on top of the latest one. */
  const overwrite = useCallback(
    (html: string) => {
      if (!conflict) return;
      versionRef.current = conflict.currentVersion;
      conflictRef.current = false;
      setConflict(null);
      pendingRef.current = html;
      void flush();
    },
    [conflict, flush],
  );

  /** Conflict resolution: discard local changes and adopt the server's version. */
  const reset = useCallback((version: number) => {
    clearTimeout(timerRef.current);
    versionRef.current = version;
    pendingRef.current = null;
    conflictRef.current = false;
    setConflict(null);
    setError(null);
    setStatus('saved');
  }, []);

  // Cmd/Ctrl+S saves immediately; warn before closing the tab with unsaved work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current !== null || savingRef.current) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flush(); // save anything outstanding when navigating away in-app
    };
  }, [flush]);

  return { status, error, conflict, savedAt, markDirty, flush, overwrite, reset };
}

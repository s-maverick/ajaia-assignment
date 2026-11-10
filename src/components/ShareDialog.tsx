import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Share, User } from '../types';
import { Avatar } from './AppHeader';

interface Props {
  documentId: string;
  title: string;
  owner: User;
  shares: Share[];
  onSharesChange: (shares: Share[]) => void;
  onClose: () => void;
}

export function ShareDialog({ documentId, title, owner, shares, onSharesChange, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Share['role']>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [directory, setDirectory] = useState<User[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.demoUsers().then(({ users }) => setDirectory(users)).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const suggestions = directory.filter((u) => u.id !== owner.id && !shares.some((s) => s.userId === u.id));

  const run = async (action: () => Promise<{ shares: Share[] }>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { shares } = await action();
      onSharesChange(shares);
      setNotice(success);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return setError('Enter the email of the person to share with.');
    if (await run(() => api.share(documentId, trimmed, role), `Shared with ${trimmed}.`)) setEmail('');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 id="share-title">Share “{title}”</h2>

        <form className="share-form" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="email"
            list="share-suggestions"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address"
          />
          <datalist id="share-suggestions">
            {suggestions.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value as Share['role'])} aria-label="Access level">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy}>Share</button>
        </form>
        {suggestions.length > 0 && (
          <p className="hint">
            Demo users: {suggestions.map((u, i) => (
              <span key={u.id}>
                {i > 0 && ', '}
                <button type="button" className="link-btn" onClick={() => setEmail(u.email)}>{u.email}</button>
              </span>
            ))}
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && !error && <p className="form-notice" role="status">{notice}</p>}

        <h3 className="modal-subhead">People with access</h3>
        <ul className="people-list">
          <li>
            <Avatar name={owner.name} small />
            <div className="person"><span>{owner.name}</span><span className="muted">{owner.email}</span></div>
            <span className="muted role-fixed">Owner</span>
          </li>
          {shares.map((s) => (
            <li key={s.userId}>
              <Avatar name={s.name} small />
              <div className="person"><span>{s.name}</span><span className="muted">{s.email}</span></div>
              <select
                value={s.role}
                disabled={busy}
                aria-label={`Access for ${s.name}`}
                onChange={(e) => run(() => api.share(documentId, s.email, e.target.value as Share['role']), `Updated ${s.name}'s access.`)}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button
                type="button"
                className="link-btn danger"
                disabled={busy}
                onClick={() => run(() => api.unshare(documentId, s.userId), `Removed ${s.name}.`)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

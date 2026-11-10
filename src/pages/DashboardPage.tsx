import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, UPLOAD_ACCEPT, UPLOAD_HINT } from '../api';
import { AppHeader } from '../components/AppHeader';
import { DocIcon, LockIcon, PlusIcon, TrashIcon, UploadIcon, UsersIcon } from '../components/icons';
import { timeAgo } from '../format';
import type { OwnedDocSummary, SharedDocSummary } from '../types';

export function DashboardPage() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [owned, setOwned] = useState<OwnedDocSummary[] | null>(null);
  const [shared, setShared] = useState<SharedDocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'import' | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listDocuments();
      setOwned(data.owned);
      setShared(data.shared);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createDoc = async () => {
    setBusy('create');
    setError(null);
    try {
      const { document } = await api.createDocument();
      navigate(`/d/${document.id}`, { state: { focusTitle: true } });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError(`“${file.name}” is larger than 5 MB.`);
    setBusy('import');
    setError(null);
    try {
      const { document } = await api.importDocument(file);
      navigate(`/d/${document.id}`);
    } catch (err) {
      setError(`Couldn't import “${file.name}”: ${(err as Error).message}`);
      setBusy(null);
    }
  };

  const deleteDoc = async (doc: OwnedDocSummary) => {
    const warning = doc.shareCount > 0 ? ` It is shared with ${doc.shareCount} ${doc.shareCount === 1 ? 'person' : 'people'} who will lose access.` : '';
    if (!window.confirm(`Delete “${doc.title}”? This cannot be undone.${warning}`)) return;
    try {
      await api.deleteDocument(doc.id);
      setOwned((docs) => docs?.filter((d) => d.id !== doc.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="page">
      <AppHeader />
      <main className="dashboard">
        <div className="dashboard-actions">
          <button type="button" className="btn btn-primary" onClick={createDoc} disabled={busy !== null}>
            <PlusIcon /> {busy === 'create' ? 'Creating…' : 'New document'}
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
            <UploadIcon /> {busy === 'import' ? 'Importing…' : 'Import file'}
          </button>
          <input ref={fileInput} type="file" accept={UPLOAD_ACCEPT} onChange={onFile} hidden />
          <span className="hint">{UPLOAD_HINT}. Imports become a new editable document.</span>
        </div>

        {error && <div className="banner banner-error" role="alert">{error}<button className="link-btn" onClick={() => setError(null)}>Dismiss</button></div>}

        <section>
          <h2 className="section-title">My documents</h2>
          {owned === null ? <p className="muted">Loading…</p> : owned.length === 0 ? (
            <div className="empty">You don't own any documents yet. Create one or import a file to get started.</div>
          ) : (
            <ul className="doc-list">
              {owned.map((d) => (
                <li key={d.id} className="doc-row">
                  <Link to={`/d/${d.id}`} className="doc-link">
                    <span className="doc-icon"><DocIcon /></span>
                    <span className="doc-title">{d.title}</span>
                  </Link>
                  <span className={`badge ${d.shareCount ? 'badge-shared' : ''}`}>
                    {d.shareCount ? <><UsersIcon /> Shared with {d.shareCount}</> : <><LockIcon /> Private</>}
                  </span>
                  <span className="muted doc-date">Edited {timeAgo(d.updatedAt)}</span>
                  <button type="button" className="icon-btn" title="Delete document" aria-label={`Delete ${d.title}`} onClick={() => deleteDoc(d)}>
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="section-title">Shared with me</h2>
          {shared === null ? <p className="muted">Loading…</p> : shared.length === 0 ? (
            <div className="empty">Nothing has been shared with you yet.</div>
          ) : (
            <ul className="doc-list">
              {shared.map((d) => (
                <li key={d.id} className="doc-row">
                  <Link to={`/d/${d.id}`} className="doc-link">
                    <span className="doc-icon doc-icon-shared"><DocIcon /></span>
                    <span className="doc-title">{d.title}</span>
                  </Link>
                  <span className={`badge ${d.role === 'editor' ? 'badge-edit' : 'badge-view'}`}>
                    {d.role === 'editor' ? 'Can edit' : 'View only'}
                  </span>
                  <span className="muted doc-date">Owner: {d.owner.name} · {timeAgo(d.updatedAt)}</span>
                  <span className="icon-btn-placeholder" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

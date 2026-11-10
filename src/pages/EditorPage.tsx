import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { api, ApiError } from '../api';
import { Avatar, UserMenu } from '../components/AppHeader';
import { Toolbar } from '../components/Toolbar';
import { ShareDialog } from '../components/ShareDialog';
import { BackIcon, DocIcon, ShareIcon } from '../components/icons';
import { useAutosave, type SaveStatus } from '../hooks/useAutosave';
import { timeAgo } from '../format';
import type { DocumentDetail, Role, Share } from '../types';

interface Loaded {
  document: DocumentDetail;
  role: Role;
  shares: Share[];
}

export function EditorPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  useEffect(() => {
    setData(null);
    setLoadError(null);
    api.getDocument(id).then(setData).catch(setLoadError);
  }, [id]);

  if (loadError) {
    const message = loadError.status === 404
      ? "This document doesn't exist, or you don't have access to it. Ask the owner to share it with you."
      : loadError.message;
    return (
      <div className="center-screen">
        <div className="empty">
          <p>{message}</p>
          <Link to="/" className="btn">Back to documents</Link>
        </div>
      </div>
    );
  }
  if (!data) return <div className="center-screen muted">Loading document…</div>;
  return <DocumentEditor key={data.document.id} initial={data} />;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes…',
  saving: 'Saving…',
  error: "Couldn't save",
  conflict: 'Not saved: edit conflict',
};

function DocumentEditor({ initial }: { initial: Loaded }) {
  const { document: doc, role } = initial;
  const canEdit = role !== 'viewer';
  const isOwner = role === 'owner';
  const location = useLocation();

  const [title, setTitle] = useState(doc.title);
  const [titleDraft, setTitleDraft] = useState(doc.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [shares, setShares] = useState(initial.shares);
  const [meta, setMeta] = useState({ lastEditedBy: doc.lastEditedBy, updatedAt: doc.updatedAt });
  const [shareOpen, setShareOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const saver = useAutosave(doc.id, doc.version);
  const { markDirty, reset: resetSaver } = saver;
  const closeShare = useCallback(() => setShareOpen(false), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: !canEdit, autolink: true },
      }),
      Placeholder.configure({ placeholder: canEdit ? 'Start writing…' : '' }),
    ],
    content: doc.contentHtml,
    editable: canEdit,
    editorProps: { attributes: { class: 'doc-content', 'aria-label': 'Document body' } },
    onUpdate: ({ editor }) => markDirty(editor.getHTML()),
  });

  // New documents: put the cursor in the title so the user can name it right away.
  useEffect(() => {
    if ((location.state as { focusTitle?: boolean } | null)?.focusTitle) titleRef.current?.select();
    else if (canEdit) editor?.commands.focus('end');
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadFromServer = useCallback(async () => {
    const fresh = await api.getDocument(doc.id);
    editor?.commands.setContent(fresh.document.contentHtml, { emitUpdate: false });
    resetSaver(fresh.document.version);
    setTitle(fresh.document.title);
    setTitleDraft(fresh.document.title);
    setShares(fresh.shares);
    setMeta({ lastEditedBy: fresh.document.lastEditedBy, updatedAt: fresh.document.updatedAt });
  }, [doc.id, editor, resetSaver]);

  // Viewers get the latest content whenever they come back to the tab.
  useEffect(() => {
    if (canEdit) return;
    const onFocus = () => void reloadFromServer().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [canEdit, reloadFromServer]);

  useEffect(() => {
    document.title = `${title} - Ajaia Docs`;
    return () => {
      document.title = 'Ajaia Docs';
    };
  }, [title]);

  const commitTitle = async () => {
    const next = titleDraft.trim();
    setTitleError(null);
    if (next === title) return setTitleDraft(title);
    if (!next) {
      setTitleDraft(title);
      return setTitleError('Title cannot be empty.');
    }
    try {
      const { document } = await api.renameDocument(doc.id, next);
      setTitle(document.title);
      setTitleDraft(document.title);
    } catch (err) {
      setTitleDraft(title);
      setTitleError((err as Error).message);
    }
  };

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.focus('start');
    } else if (e.key === 'Escape') {
      setTitleDraft(title);
      e.currentTarget.blur();
    }
  };

  return (
    <div className="page editor-page">
      {/* Header, toolbar and status banners stay pinned so save problems are always visible. */}
      <div className="editor-chrome">
        <header className="editor-header">
          <Link to="/" className="icon-btn" title="Back to documents" aria-label="Back to documents"><BackIcon /></Link>
          <span className="brand-mark"><DocIcon /></span>
          <div className="title-block">
            {canEdit ? (
              <input
                ref={titleRef}
                className="title-input"
                value={titleDraft}
                maxLength={200}
                aria-label="Document title"
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={onTitleKey}
              />
            ) : (
              <h1 className="title-static">{title}</h1>
            )}
            <div className="title-meta">
              {isOwner ? (
                <span className="badge">Owner</span>
              ) : (
                <span className={`badge ${role === 'editor' ? 'badge-edit' : 'badge-view'}`}>
                  {role === 'editor' ? 'Can edit' : 'View only'} · shared by {doc.owner.name}
                </span>
              )}
              {canEdit && (
                <span className={`save-status status-${saver.status}`} role="status">
                  {STATUS_TEXT[saver.status]}
                  {saver.status === 'error' && (
                    <button type="button" className="link-btn" onClick={() => void saver.flush()}>Retry</button>
                  )}
                </span>
              )}
              {!canEdit && meta.lastEditedBy && (
                <span className="muted">Last edited by {meta.lastEditedBy} {timeAgo(meta.updatedAt)}</span>
              )}
              {titleError && <span className="form-error inline">{titleError}</span>}
            </div>
          </div>
          <div className="editor-header-right">
            <div className="collaborators" aria-label="People with access">
              {shares.slice(0, 4).map((s) => <Avatar key={s.userId} name={s.name} small />)}
            </div>
            {isOwner && (
              <button type="button" className="btn btn-primary" onClick={() => setShareOpen(true)}>
                <ShareIcon /> Share
              </button>
            )}
            <UserMenu />
          </div>
        </header>

        {canEdit && editor && <Toolbar editor={editor} />}

        {!canEdit && (
          <div className="banner banner-info">
            You have view-only access. Ask {doc.owner.name} for edit access if you need to make changes.
          </div>
        )}
        {saver.status === 'error' && saver.error && (
          <div className="banner banner-error" role="alert">
            Your latest changes aren't saved yet ({saver.error}). We'll retry when you keep typing, or you can retry now.
            <button type="button" className="btn btn-sm" onClick={() => void saver.flush()}>Retry now</button>
          </div>
        )}
        {saver.conflict && (
          <div className="banner banner-warn" role="alert">
            <span>
              {saver.conflict.lastEditedBy ?? 'Someone else'} saved changes to this document while you were editing.
              Your latest edits are not saved.
            </span>
            <span className="banner-actions">
              <button type="button" className="btn btn-sm" onClick={() => void reloadFromServer()}>Load their version</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => editor && saver.overwrite(editor.getHTML())}>
                Keep mine (overwrite)
              </button>
            </span>
          </div>
        )}
      </div>

      <main className="editor-canvas" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <div className="doc-page">
          <EditorContent editor={editor} />
        </div>
      </main>

      {shareOpen && (
        <ShareDialog
          documentId={doc.id}
          title={title}
          owner={doc.owner}
          shares={shares}
          onSharesChange={setShares}
          onClose={closeShare}
        />
      )}
    </div>
  );
}

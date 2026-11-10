import { useEditorState, type Editor } from '@tiptap/react';
import type { ReactNode } from 'react';
import {
  BoldIcon, BulletListIcon, ClearIcon, ItalicIcon, OrderedListIcon, QuoteIcon, RedoIcon, StrikeIcon,
  UnderlineIcon, UndoIcon,
} from './icons';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

function ToolButton({ label, active, disabled, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool-btn${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep focus (and the selection) in the editor while clicking toolbar buttons.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';

export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      block: (e.isActive('heading', { level: 1 }) ? 'h1'
        : e.isActive('heading', { level: 2 }) ? 'h2'
        : e.isActive('heading', { level: 3 }) ? 'h3'
        : 'paragraph') as BlockStyle,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const setBlock = (value: BlockStyle) => {
    const chain = editor.chain().focus();
    if (value === 'paragraph') chain.setParagraph().run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton label={`Undo (${mod}Z)`} disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}><UndoIcon /></ToolButton>
      <ToolButton label={`Redo (${mod}Shift+Z)`} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}><RedoIcon /></ToolButton>
      <span className="tool-sep" />
      <select
        className="block-select"
        aria-label="Text style"
        value={state.block}
        onChange={(e) => setBlock(e.target.value as BlockStyle)}
      >
        <option value="paragraph">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span className="tool-sep" />
      <ToolButton label={`Bold (${mod}B)`} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><BoldIcon /></ToolButton>
      <ToolButton label={`Italic (${mod}I)`} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><ItalicIcon /></ToolButton>
      <ToolButton label={`Underline (${mod}U)`} active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /></ToolButton>
      <ToolButton label={`Strikethrough (${mod}Shift+S)`} active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><StrikeIcon /></ToolButton>
      <span className="tool-sep" />
      <ToolButton label={`Bulleted list (${mod}Shift+8)`} active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><BulletListIcon /></ToolButton>
      <ToolButton label={`Numbered list (${mod}Shift+7)`} active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><OrderedListIcon /></ToolButton>
      <ToolButton label="Quote" active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><QuoteIcon /></ToolButton>
      <span className="tool-sep" />
      <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><ClearIcon /></ToolButton>
    </div>
  );
}

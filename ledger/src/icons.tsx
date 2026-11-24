// Ledger's own icon set. Categories are stored with an emoji (Budgets lets you type any
// emoji for a new one); the ones below are drawn instead, as a line icon on a tile tinted
// with the category's colour, so the lists look the same on every device. An emoji that
// isn't in this list is shown as it is.
import type { ReactNode } from 'react';

const c = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} />;

const ICONS: Record<string, { tint: string; art: ReactNode }> = {
  '🛒': { tint: '#2a78d6', art: <><path d="M3 4h2.5l2.2 10.5h9.6L19.5 7H7" />{c(9.5, 18.5, 1.3)}{c(16.5, 18.5, 1.3)}</> },
  '🍜': { tint: '#eb6834', art: <path d="M6 3v6a2.5 2.5 0 0 0 5 0V3M8.5 3v18M17.5 21v-9h-3c0-4 1-7 3-9z" /> },
  '⛽': { tint: '#1baf7a', art: <path d="M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14M4 20h11M7.5 8h4v3h-4zM14 11h1.5A1.5 1.5 0 0 1 17 12.500V16a1.5 1.5 0 0 0 3 0V9l-2.5-2.5" /> },
  '🛍': { tint: '#eda100', art: <path d="M6 8h12l1 12H5zM9 8V7a3 3 0 0 1 6 0v1" /> },
  '🎬': { tint: '#e87ba4', art: <path d="M4 6h16v12H4zM10 9.500v5l4.500-2.500z" /> },
  '💊': { tint: '#19a34a', art: <path d="M12 20s-7-4.400-7-9.500A3.800 3.800 0 0 1 12 8a3.800 3.800 0 0 1 7 2.500C19 15.600 12 20 12 20zM8.500 12.500h2l1-2 1.500 3.500 1-1.500h1.500" /> },
  '✈': { tint: '#7b6be6', art: <path d="M3 12.500l18-7.500-6 16-3.500-6zM11.500 15l4-4.500" /> },
  '🏠': { tint: '#e34948', art: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /> },
  '💡': { tint: '#4f9fae', art: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.600.500 1 1.300 1 2.100h5c0-.800.400-1.600 1-2.100A6 6 0 0 0 12 3z" /> },
  '🔁': { tint: '#b9773a', art: <path d="M4 11a8 8 0 0 1 14-4l2-2v6h-6M20 13a8 8 0 0 1-14 4l-2 2v-6h6" /> },
  '🛡': { tint: '#8a90a0', art: <path d="M12 3l7 3v6c0 4.500-3 7.700-7 9-4-1.300-7-4.500-7-9V6zM9 12l2.200 2.200L15 10.500" /> },
  '📦': { tint: '#9a9aa5', art: <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" /> },
  '💵': { tint: '#1faa62', art: <><path d="M3 7h18v10H3zM6 10.500v3M18 10.500v3" />{c(12, 12, 2.5)}</> },
  '↔': { tint: '#9a9aa5', art: <path d="M4 9h15l-3-3M20 15H5l3 3" /> },
  '🧑‍🏫': { tint: '#7b6be6', art: <path d="M2 9l10-5 10 5-10 5zM6 11.500V16c1.500 1.600 3.600 2.500 6 2.500s4.500-.900 6-2.500v-4.500M22 9v5" /> },
  '🏦': { tint: '#6f82ad', art: <path d="M3 10l9-6 9 6M5 10v8M9.500 10v8M14.500 10v8M19 10v8M3 20h18" /> },
  '💸': { tint: '#d0554f', art: <><path d="M6 18L18 6" />{c(7.5, 7.5, 2.2)}{c(16.5, 16.5, 2.2)}</> },
  '🐾': { tint: '#a8854a', art: <>{c(7, 11, 1.5)}{c(10.2, 7, 1.5)}{c(13.8, 7, 1.5)}{c(17, 11, 1.5)}<path d="M8.500 16.500c0-2 1.600-3.700 3.500-3.700s3.500 1.700 3.500 3.700c0 1.500-1.300 2.500-2.700 2.100-.500-.100-1.100-.100-1.600 0-1.400.400-2.700-.600-2.700-2.100z" /></> },
  '💇': { tint: '#c06aa8', art: <>{c(6, 6.5, 2.5)}{c(6, 17.5, 2.5)}<path d="M8 8l12 9.500M8 16L20 6.500" /></> },
  '🧾': { tint: '#8f7ae8', art: <path d="M7 3h10v18l-2.500-1.500L12 21l-2.500-1.500L7 21zM10 8h4M10 12h4" /> },
  '🏷': { tint: '#b9773a', art: <><path d="M3 12V4h8l10 10-8 8z" />{c(7.5, 8.5, 1.2)}</> },
  '💳': { tint: '#6f82ad', art: <path d="M3 6h18v12H3zM3 10h18M7 15h3" /> },
};

// Emoji often carry an invisible "show as a picture" mark; it is dropped before looking one up.
const plain = (s: string) => s.replace(/️/g, '').trim();

/** A category's icon: one of Ledger's own where there is one, otherwise the emoji or letter given. */
export function CatIcon({ icon, edit }: { icon?: string | number | null; edit?: { id: number; name: string } }) {
  // With `edit`, the icon is a button that opens the icon choices for that category (IconDialog, in the shell).
  if (edit?.id) return <button type="button" className="logo-btn" aria-label={`Change the icon for ${edit.name}`} title="Change this icon" onClick={(e) => { e.stopPropagation(); e.preventDefault(); dispatchEvent(new CustomEvent('ledger-icon-edit', { detail: { ...edit, icon: String(icon ?? '') } })); }}><CatIcon icon={icon} /></button>;
  const text = String(icon ?? '?');
  const mine = ICONS[plain(text)];
  if (!mine) return <span className="emoji">{text}</span>;
  return (
    <span className="emoji glyph" style={{ '--tint': mine.tint } as React.CSSProperties}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mine.art}</svg>
    </span>
  );
}

// Emoji offered when you make a category, so there's no hunting for the emoji keyboard.
const CHOICES = ['💇', '🎁', '👕', '👶', '🎓', '📚', '🏋️', '🎮', '☕', '🍺', '🚗', '🔧', '🧹', '🌱', '💻', '📱', '🎵', '⚽', '🏥', '🦷', '💄', '🧸', '⛪', '💝', '🧾', '🏷️'];

/** Choose a category's icon by clicking one, or type any emoji of your own. */
export function EmojiPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="emoji-pick">
      <span className="label">Icon</span>
      <div className="emoji-grid" role="group" aria-label="Icon">
        {CHOICES.map((e) => (
          <button key={e} type="button" className={value === e ? 'on' : ''} aria-pressed={value === e} aria-label={`Use ${e}`} onClick={() => onChange(value === e ? '' : e)}><CatIcon icon={e} /></button>
        ))}
      </div>
      <label className="emoji-own">or type your own<input type="text" value={CHOICES.includes(value) ? '' : value} maxLength={4} placeholder="🙂" onChange={(e) => onChange(e.target.value)} /></label>
      <small>On a Mac, Control-Command-Space opens every emoji while you're in that box.</small>
    </div>
  );
}

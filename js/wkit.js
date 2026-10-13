// Small pieces shared by the widgets.

import { escHtml as esc } from './ui.js';

export { esc };
export const num = (n) => Number(n).toLocaleString();
export const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
export const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function debounce(fn, ms) {
  let t = null;
  const d = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
  d.flush = () => {
    if (t === null) return;
    clearTimeout(t);
    t = null;
    fn();
  };
  return d;
}

// A value that copies itself when clicked.
export const copyBtn = (text, copy = text, cls = '') =>
  `<button type="button" class="kv-val${cls ? ' ' + cls : ''}" data-wcopy="${esc(copy)}" title="Copy">${esc(text)}</button>`;

// rows: [label, shown, copyValue (false: not copyable), extra, class ('' for ordinary text)]
export function kvList(rows) {
  return `<dl class="kvs">${rows
    .filter(Boolean)
    .map(([label, value, copy, extra, cls]) => {
      const v = copy === false ? `<span class="kv-text">${esc(value)}</span>` : copyBtn(value, copy == null ? value : copy, cls == null ? 'code' : cls);
      return `<div class="kv"><dt>${esc(label)}</dt><dd>${v}${extra ? `<span class="kv-extra">${extra}</span>` : ''}</dd></div>`;
    })
    .join('')}</dl>`;
}


// "4:05 PM"
export const clockTime = (ms) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

// "just now", "4 min ago", "2 h ago"
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 50) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

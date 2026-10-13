// Import and export. Two inputs are understood:
//  - Shelfmark backups (.json)
//  - the bookmarks HTML file Chrome, Firefox, Edge and Safari all export
// Both are reduced to the same shape: a list of groups, each with a list of links.

import { normalizeDoc, newGroup, newBookmark, nextColor, matchKey, COLORS, isValidUrl, fallbackTitle } from './model.js';

export function exportPayload(doc, stats, widgets) {
  return {
    app: 'shelfmark',
    schema: doc.schema,
    exported: new Date().toISOString(),
    doc,
    stats: stats || {},
    widgets: widgets || {},
  };
}

export function backupFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `shelfmark-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Returns { kind, groups, doc?, stats? } or throws an Error with a readable message.
export function parseImportText(text, filename = '') {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return parseBackup(trimmed);
  if (/<!DOCTYPE NETSCAPE-Bookmark-file-1>/i.test(trimmed) || /<DL>/i.test(trimmed)) return parseBookmarksHtml(trimmed);
  throw new Error(`${filename || 'That file'} isn't a Shelfmark backup or a browser bookmarks export.`);
}

function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That backup file is damaged and can't be read.");
  }
  const docRaw = raw && raw.doc ? raw.doc : raw;
  if (!docRaw || !Array.isArray(docRaw.groups)) throw new Error("That JSON file isn't a Shelfmark backup.");
  const doc = normalizeDoc(docRaw);
  const groups = doc.groups.map((g) => ({
    name: g.name,
    color: g.color,
    mode: g.mode,
    reuse: g.reuse,
    openAllIn: g.openAllIn,
    items: g.items.map((id) => doc.bookmarks[id]),
  }));
  const widgets = raw.widgets && typeof raw.widgets === 'object' && !Array.isArray(raw.widgets) ? raw.widgets : null;
  return { kind: 'backup', doc, stats: raw.stats || {}, widgets, groups };
}

const ROOT_NAMES = /^(bookmarks bar|bookmarks toolbar|favorites bar|other bookmarks|bookmarks menu|mobile bookmarks|favorites)$/i;

function parseBookmarksHtml(text) {
  const dom = new DOMParser().parseFromString(text, 'text/html');
  const top = dom.querySelector('dl');
  if (!top) throw new Error('No bookmarks were found in that file.');
  const groups = new Map(); // name -> { name, items }

  const add = (path, link) => {
    const name = path.length ? path.join(' / ') : 'Imported';
    if (!groups.has(name)) groups.set(name, { name, items: [] });
    groups.get(name).items.push(link);
  };

  const walk = (dl, path) => {
    for (const dt of Array.from(dl.children)) {
      if (dt.tagName !== 'DT') continue;
      const a = dt.querySelector(':scope > a');
      const h3 = dt.querySelector(':scope > h3');
      if (a) {
        const url = a.getAttribute('href') || '';
        if (!url || !isValidUrl(url) || /^place:/i.test(url)) continue;
        const added = Number(a.getAttribute('add_date'));
        add(path, {
          url,
          title: (a.textContent || '').trim() || fallbackTitle(url),
          tags: (a.getAttribute('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
          added: Number.isFinite(added) && added > 0 ? added * 1000 : Date.now(),
        });
      } else if (h3) {
        let sub = dt.querySelector(':scope > dl');
        if (!sub && dt.nextElementSibling && dt.nextElementSibling.tagName === 'DL') sub = dt.nextElementSibling;
        const name = (h3.textContent || '').trim() || 'Folder';
        // Drop the browser's own root folder name once we're below it.
        const nextPath = path.length === 0 && ROOT_NAMES.test(name) ? [name] : [...path.filter((p) => !ROOT_NAMES.test(p)), name];
        if (sub) walk(sub, nextPath);
      }
    }
  };
  walk(top, []);

  const list = Array.from(groups.values()).filter((g) => g.items.length);
  if (!list.length) throw new Error('No bookmarks were found in that file.');
  return { kind: 'html', groups: list };
}

// Adds parsed groups to doc. Groups with the same name are merged.
export function mergeInto(doc, parsed, { skipDuplicates = true } = {}) {
  const seen = new Set(Object.values(doc.bookmarks).map((b) => matchKey(b.url)));
  let groupsAdded = 0;
  let bookmarksAdded = 0;
  let skipped = 0;

  for (const pg of parsed.groups) {
    let target = doc.groups.find((g) => g.name.toLowerCase() === pg.name.toLowerCase());
    const fresh = !target;
    if (fresh) {
      const color = pg.color && COLORS.includes(pg.color) ? pg.color : nextColor(doc);
      target = newGroup(pg.name, color);
      if (pg.mode) target.mode = pg.mode;
      if (pg.reuse !== undefined) target.reuse = pg.reuse;
      if (pg.openAllIn) target.openAllIn = pg.openAllIn;
    }
    let addedHere = 0;
    for (const item of pg.items) {
      const key = matchKey(item.url);
      if (skipDuplicates && seen.has(key)) { skipped++; continue; }
      seen.add(key);
      const bm = newBookmark({
        url: item.url,
        title: item.title || fallbackTitle(item.url),
        mode: item.mode || null,
        reuse: item.reuse === undefined ? null : item.reuse,
        tags: item.tags || [],
        notes: item.notes || '',
      });
      if (item.added) bm.added = item.added;
      doc.bookmarks[bm.id] = bm;
      target.items.push(bm.id);
      addedHere++;
    }
    if (fresh && addedHere) {
      doc.groups.push(target);
      groupsAdded++;
    }
    bookmarksAdded += addedHere;
  }
  return { groupsAdded, bookmarksAdded, skipped };
}

export function summarize(parsed) {
  const n = parsed.groups.reduce((s, g) => s + g.items.length, 0);
  return { groups: parsed.groups.length, bookmarks: n };
}

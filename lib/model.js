// Data model: one versioned document holds settings, groups and bookmarks.
// Open behavior inherits: settings default -> group -> bookmark.

export const SCHEMA = 1;

export const MODES = {
  tab:        { label: 'New tab',        hint: 'Opens in a new tab next to this one' },
  background: { label: 'Background tab', hint: 'Opens in a new tab without leaving this page' },
  current:    { label: 'Same tab',       hint: 'Replaces the current tab' },
  window:     { label: 'New window',     hint: 'Opens in a new browser window' },
  private:    { label: 'Private window', hint: 'Opens in an incognito window' },
  app:        { label: 'App window',     hint: 'Opens in a window without toolbars' },
};
export const MODE_ORDER = ['tab', 'background', 'current', 'window', 'private', 'app'];

// Chrome's tab-group palette, so a group looks the same here and as a tab group.
export const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const COLOR_LABELS = {
  grey: 'Grey', blue: 'Blue', red: 'Red', yellow: 'Yellow', green: 'Green',
  pink: 'Pink', purple: 'Purple', cyan: 'Cyan', orange: 'Orange',
};

export function uid(prefix = '') {
  const rand = Math.random().toString(36).slice(2, 9);
  return prefix + Date.now().toString(36).slice(-5) + rand;
}

export const LAYOUT_IDS = ['columns', 'list', 'tiles', 'sidebar', 'table', 'launcher'];

// Widgets, in their default order. 'calc' answers in the search box; the rest are panels.
// Settings keep every widget with its on/off state, in the order they're shown.
export const WIDGET_IDS = ['calc', 'clocks', 'dates', 'scratch', 'subnet', 'timestamp'];
const WIDGET_DEFAULT_ON = { calc: true };

export function defaultWidgets() {
  return WIDGET_IDS.map((id) => ({ id, on: !!WIDGET_DEFAULT_ON[id] }));
}

function normalizeWidgets(raw) {
  if (!Array.isArray(raw)) return defaultWidgets();
  const out = [];
  for (const w of raw) {
    if (w && WIDGET_IDS.includes(w.id) && !out.some((x) => x.id === w.id)) out.push({ id: w.id, on: w.on === true });
  }
  // Widgets added in a later version join at the end, with their default state.
  for (const id of WIDGET_IDS) if (!out.some((x) => x.id === id)) out.push({ id, on: !!WIDGET_DEFAULT_ON[id] });
  return out;
}

export const widgetOn = (settings, id) => settings.widgets.some((w) => w.id === id && w.on);

export function defaultSettings() {
  return {
    defaultMode: 'tab',
    defaultReuse: false,
    theme: 'system',
    layout: 'columns',
    density: 'comfortable',
    openOnStartup: false,
    setupDone: false,
    siteIcons: 'letters', // website only: 'letters' or 'site' (ask each site for its icon)
    widgets: defaultWidgets(),
  };
}

export function emptyDoc() {
  return { schema: SCHEMA, settings: defaultSettings(), groups: [], bookmarks: {} };
}

const isMode = (m) => typeof m === 'string' && m in MODES;
const isBoolOrNull = (v) => v === true || v === false || v === null;

// Repairs anything malformed so the UI never has to defend against bad data.
export function normalizeDoc(raw) {
  const doc = emptyDoc();
  if (!raw || typeof raw !== 'object') return doc;

  const s = raw.settings || {};
  doc.settings.defaultMode = isMode(s.defaultMode) ? s.defaultMode : 'tab';
  doc.settings.defaultReuse = s.defaultReuse === true;
  doc.settings.theme = ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system';
  doc.settings.layout = LAYOUT_IDS.includes(s.layout) ? s.layout : 'columns';
  doc.settings.density = s.density === 'compact' ? 'compact' : 'comfortable';
  doc.settings.openOnStartup = s.openOnStartup === true;
  doc.settings.setupDone = s.setupDone === true;
  doc.settings.siteIcons = s.siteIcons === 'site' ? 'site' : 'letters';
  doc.settings.widgets = normalizeWidgets(s.widgets);

  const rawBms = raw.bookmarks && typeof raw.bookmarks === 'object' ? raw.bookmarks : {};
  for (const [id, b] of Object.entries(rawBms)) {
    if (!b || typeof b.url !== 'string' || !b.url) continue;
    doc.bookmarks[id] = {
      id,
      url: b.url,
      title: typeof b.title === 'string' ? b.title : '',
      mode: isMode(b.mode) ? b.mode : null,
      reuse: isBoolOrNull(b.reuse) ? b.reuse : null,
      tags: Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [],
      notes: typeof b.notes === 'string' ? b.notes : '',
      added: Number.isFinite(b.added) ? b.added : Date.now(),
    };
  }

  const placed = new Set();
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  for (const g of rawGroups) {
    if (!g || typeof g.id !== 'string') continue;
    const items = (Array.isArray(g.items) ? g.items : []).filter((id) => doc.bookmarks[id] && !placed.has(id));
    items.forEach((id) => placed.add(id));
    doc.groups.push({
      id: g.id,
      name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : 'Untitled group',
      color: COLORS.includes(g.color) ? g.color : 'grey',
      mode: isMode(g.mode) ? g.mode : null,
      reuse: isBoolOrNull(g.reuse) ? g.reuse : null,
      openAllIn: g.openAllIn === 'window' ? 'window' : 'here',
      collapsed: g.collapsed === true,
      items,
    });
  }

  // Bookmarks that belong to no group are kept, not silently dropped.
  const orphans = Object.keys(doc.bookmarks).filter((id) => !placed.has(id));
  if (orphans.length) {
    let inbox = doc.groups.find((g) => g.name === 'Unsorted');
    if (!inbox) {
      inbox = newGroup('Unsorted', 'grey');
      doc.groups.push(inbox);
    }
    inbox.items.push(...orphans);
  }
  return doc;
}

// The tab-group color used least so far (grey is left for people to pick on purpose).
export function nextColor(doc) {
  const counts = Object.fromEntries(COLORS.filter((c) => c !== 'grey').map((c) => [c, 0]));
  for (const g of doc.groups) if (g.color in counts) counts[g.color]++;
  return Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0];
}

export function newGroup(name, color = 'blue') {
  return { id: uid('g'), name, color, mode: null, reuse: null, openAllIn: 'here', collapsed: false, items: [] };
}

export function newBookmark({ url, title = '', mode = null, reuse = null, tags = [], notes = '' }) {
  return { id: uid('b'), url, title, mode, reuse, tags, notes, added: Date.now() };
}

export function groupOf(doc, bookmarkId) {
  return doc.groups.find((g) => g.items.includes(bookmarkId)) || null;
}

export function groupDefaults(doc, group) {
  const s = doc.settings;
  return {
    mode: group && group.mode ? group.mode : s.defaultMode,
    modeSource: group && group.mode ? 'group' : 'default',
    reuse: group && group.reuse !== null ? group.reuse : s.defaultReuse,
    reuseSource: group && group.reuse !== null ? 'group' : 'default',
  };
}

// The behavior a bookmark actually has, and where each part came from.
export function effective(doc, bm, group = groupOf(doc, bm.id)) {
  const g = groupDefaults(doc, group);
  return {
    mode: bm.mode || g.mode,
    modeSource: bm.mode ? 'bookmark' : g.modeSource,
    reuse: bm.reuse !== null ? bm.reuse : g.reuse,
    reuseSource: bm.reuse !== null ? 'bookmark' : g.reuseSource,
  };
}

// Adds https:// when someone types a bare domain.
export function cleanUrl(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^localhost(:\d+)?(\/|$)/i.test(v)) return 'http://' + v;
  return 'https://' + v;
}

export function isValidUrl(u) {
  try {
    const p = new URL(u);
    // Bookmarklets can't run from an extension-opened tab, so don't accept them.
    return p.protocol !== 'javascript:';
  } catch {
    return false;
  }
}

// Two URLs that would show the same page compare equal.
export function matchKey(u) {
  try {
    const p = new URL(u);
    let path = p.pathname.replace(/\/+$/, '');
    return (p.protocol + '//' + p.host.toLowerCase() + path + p.search).toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}

export function displayHost(u) {
  try {
    const p = new URL(u);
    if (p.protocol === 'file:') return 'file';
    if (!p.host) return p.protocol.replace(':', '');
    return p.host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function fallbackTitle(u) {
  try {
    const p = new URL(u);
    const path = p.pathname.replace(/\/+$/, '');
    return displayHost(u) + (path && path !== '/' ? path : '');
  } catch {
    return u;
  }
}

export function findByUrl(doc, url) {
  const key = matchKey(url);
  return Object.values(doc.bookmarks).find((b) => matchKey(b.url) === key) || null;
}

export function moveBookmark(doc, id, toGroupId, toIndex) {
  const from = groupOf(doc, id);
  const to = doc.groups.find((g) => g.id === toGroupId);
  if (!to) return;
  if (from) {
    const i = from.items.indexOf(id);
    from.items.splice(i, 1);
    if (from === to && i < toIndex) toIndex -= 1;
  }
  const idx = Math.max(0, Math.min(toIndex, to.items.length));
  to.items.splice(idx, 0, id);
}

export function deleteBookmark(doc, id) {
  const g = groupOf(doc, id);
  if (g) g.items = g.items.filter((x) => x !== id);
  delete doc.bookmarks[id];
}

export function deleteGroup(doc, groupId) {
  const g = doc.groups.find((x) => x.id === groupId);
  if (!g) return;
  g.items.forEach((id) => delete doc.bookmarks[id]);
  doc.groups = doc.groups.filter((x) => x.id !== groupId);
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

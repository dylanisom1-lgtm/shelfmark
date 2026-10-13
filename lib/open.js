// Opening links the way each bookmark asks to be opened.
// In the extension this uses the tabs and windows APIs (from pages and the background).
// On the website it uses what a web page is allowed to do; see the "website" section.

import { effective, groupDefaults, matchKey } from './model.js';
import { recordOpen } from './store.js';
import { ext, MODE } from './browser.js';

const api = ext && ext.tabs ? ext : null;

export class OpenError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    Object.assign(this, detail);
  }
}

// Preview pages have no tabs API; they register a hook that describes what would happen.
function previewOpen(info) {
  const hook = globalThis.__SHELFMARK_PREVIEW_OPEN__;
  if (hook) hook(info);
}

export async function incognitoAllowed() {
  if (!api) return false;
  try {
    return await api.extension.isAllowedIncognitoAccess();
  } catch {
    return false;
  }
}


// --- "already open" detection ----------------------------------------------
// Sites redirect on arrival and change their address as you click around, so an
// exact-address match alone misses most real tabs. A tab counts as already open if,
// in this order:
//   1. it shows exactly the bookmarked page (ignoring #fragments and trailing slashes),
//   2. Shelfmark opened it from this bookmark and it's still on the same site,
//   3. it's on the same site at or below the bookmarked path. A bookmark to a site's
//      front page therefore counts any tab on that site.
// "Same site" ignores www. and http vs https.

const TRACK_KEY = 'shelfmark.openedTabs';
const session = api && api.storage && api.storage.session ? api.storage.session : null;

async function trackedTabs() {
  if (!session) return {};
  try {
    return (await session.get(TRACK_KEY))[TRACK_KEY] || {};
  } catch {
    return {};
  }
}

// Remembers which tab each bookmark opened, for this browser session only.
async function track(pairs) {
  if (!session || !pairs.length) return;
  try {
    const map = await trackedTabs();
    for (const [bookmarkId, tabId] of pairs) if (bookmarkId && tabId != null) map[bookmarkId] = tabId;
    await session.set({ [TRACK_KEY]: map });
  } catch { /* tracking is best effort */ }
}

const tabUrl = (t) => t.url || t.pendingUrl || '';

function siteOf(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return { host: p.host.toLowerCase().replace(/^www\./, ''), path: p.pathname.replace(/\/+$/, '').toLowerCase() };
  } catch {
    return null;
  }
}

function underPath(path, base) {
  return !base || path === base || path.startsWith(base + '/');
}

// Among several candidates, prefer the window you're in, then the most recently used tab.
async function pickBest(list) {
  if (list.length < 2) return list[0] || null;
  let focusedId = null;
  try {
    focusedId = (await api.windows.getLastFocused()).id;
  } catch { /* none */ }
  return [...list].sort((a, b) => {
    const wa = a.windowId === focusedId ? 1 : 0;
    const wb = b.windowId === focusedId ? 1 : 0;
    if (wa !== wb) return wb - wa;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  })[0];
}

async function findOpenTab(url, incognito, bookmarkId) {
  const tabs = (await api.tabs.query({})).filter((t) => tabUrl(t) && !!t.incognito === !!incognito);

  const key = matchKey(url);
  const exact = tabs.filter((t) => matchKey(tabUrl(t)) === key);
  if (exact.length) return pickBest(exact);

  const site = siteOf(url);
  if (!site) return null;

  if (bookmarkId) {
    const id = (await trackedTabs())[bookmarkId];
    const t = tabs.find((x) => x.id === id);
    const s = t && siteOf(tabUrl(t));
    if (s && s.host === site.host) return t;
  }

  const same = tabs.filter((t) => {
    const s = siteOf(tabUrl(t));
    return s && s.host === site.host && underPath(s.path, site.path);
  });
  return pickBest(same);
}

async function focusTab(tab) {
  await api.tabs.update(tab.id, { active: true });
  await api.windows.update(tab.windowId, { focused: true });
  return tab;
}

async function existingIncognitoWindow() {
  const wins = await api.windows.getAll({ windowTypes: ['normal'] });
  return wins.find((w) => w.incognito) || null;
}

const firstTab = (r) => (r && Array.isArray(r.tabs) ? r.tabs[0] : r) || null;

// --- website -------------------------------------------------------------------
// A web page can open new tabs and pop-up windows from a click, navigate itself, and
// find tabs it opened earlier by name. It can't open private windows, open background
// tabs, see tabs it didn't open, or open more than one tab per click unless pop-ups are
// allowed for the site.

function webWindow(url, mode, name = '_blank') {
  const features = mode === 'app' ? 'popup,width=1280,height=860' : mode === 'window' ? 'popup,width=1200,height=820' : '';
  const w = window.open(url, name, features);
  if (!w) throw new OpenError('blocked', 'The browser blocked the new tab.');
  try {
    w.opener = null; // the opened site can't reach back into Shelfmark
  } catch { /* already navigated */ }
  return w;
}

// Reuses the tab this bookmark opened before, if it's still open: window.open with an
// empty address finds a tab by name without reloading it.
function webOpenNamed(url, name, mode) {
  const features = mode === 'app' ? 'popup,width=1280,height=860' : mode === 'window' ? 'popup,width=1200,height=820' : '';
  const w = window.open('', name, features);
  if (!w) throw new OpenError('blocked', 'The browser blocked the new tab.');
  let fresh = false;
  try {
    fresh = w.location.href === 'about:blank';
  } catch {
    fresh = false; // a different site is showing in it, so it's the one we opened before
  }
  if (fresh) {
    // The tab keeps its link back to Shelfmark: browsers only let a page find a tab by
    // name later if that link is intact. (The opened site could, in principle, use it to
    // redirect the Shelfmark tab; other bookmarks drop the link.)
    w.location.replace(url);
    return { reused: false };
  }
  w.focus();
  return { reused: true };
}

function webOpenUrl(url, { mode, reuse, bookmarkId }) {
  if (mode === 'private') throw new OpenError('private-unsupported', 'A website can’t open private windows.');
  if (mode === 'current') {
    window.location.assign(url);
    return { reused: false };
  }
  if (reuse && bookmarkId) return webOpenNamed(url, 'shelfmark-' + bookmarkId, mode);
  webWindow(url, mode); // "open another copy": always a fresh tab
  return { reused: false };
}

// fromTab: the tab the request came from, so new tabs land beside it.
// bookmarkId: lets "already open" recognize tabs this bookmark opened earlier.
export async function openUrl(url, { mode = 'tab', reuse = false, fromTab = null, bookmarkId = null } = {}) {
  if (MODE === 'web') return webOpenUrl(url, { mode, reuse, bookmarkId });
  if (!api) {
    previewOpen({ kind: 'link', url, mode, reuse });
    return null;
  }
  const tab = firstTab(await openUrlRaw(url, { mode, reuse, fromTab, bookmarkId }));
  if (tab && bookmarkId) await track([[bookmarkId, tab.id]]);
  return tab;
}

async function openUrlRaw(url, { mode, reuse, fromTab, bookmarkId }) {
  if (mode === 'private') {
    if (!(await incognitoAllowed())) {
      throw new OpenError('incognito-denied', 'Private windows are turned off for Shelfmark.');
    }
    if (reuse) {
      const t = await findOpenTab(url, true, bookmarkId);
      if (t) return focusTab(t);
    }
    const win = await existingIncognitoWindow();
    if (win) {
      const tab = await api.tabs.create({ windowId: win.id, url, active: true });
      await api.windows.update(win.id, { focused: true });
      return tab;
    }
    return api.windows.create({ url, incognito: true, focused: true });
  }

  if (reuse) {
    const t = await findOpenTab(url, false, bookmarkId);
    if (t) return focusTab(t);
  }

  const beside = fromTab && !fromTab.incognito ? { windowId: fromTab.windowId, index: fromTab.index + 1 } : {};
  switch (mode) {
    case 'background':
      return api.tabs.create({ url, active: false, ...beside });
    case 'current':
      if (fromTab) return api.tabs.update(fromTab.id, { url });
      return api.tabs.update({ url });
    case 'window':
      return api.windows.create({ url, focused: true });
    case 'app':
      return api.windows.create({ url, type: 'popup', width: 1280, height: 860, focused: true });
    case 'tab':
    default:
      return api.tabs.create({ url, active: true, ...beside });
  }
}

// override: a mode chosen at click time (modifier keys) that beats the stored one.
export async function openBookmark(doc, id, { override = null, fromTab = null } = {}) {
  const bm = doc.bookmarks[id];
  if (!bm) return;
  const eff = effective(doc, bm);
  const mode = override || eff.mode;
  const r = await openUrl(bm.url, { mode, reuse: eff.reuse, fromTab, bookmarkId: id });
  recordOpen(id);
  return { mode, reused: !!(r && r.reused) };
}

// Opens a whole group. Bookmarks that resolve to "private" go to an incognito window;
// the rest open together as a tab group titled and colored like the group.
export async function openGroup(doc, groupId, { fromTab = null } = {}) {
  const group = doc.groups.find((g) => g.id === groupId);
  if (!group) return { opened: 0, skippedPrivate: 0 };
  const bms = group.items.map((id) => doc.bookmarks[id]).filter(Boolean);
  const priv = [];
  const normal = [];
  for (const bm of bms) (effective(doc, bm, group).mode === 'private' ? priv : normal).push(bm);

  if (MODE === 'web') {
    // One tab per click unless pop-ups are allowed for the site; count what got through.
    let opened = 0;
    let blocked = 0;
    for (const bm of normal) {
      try {
        webWindow(bm.url, 'tab');
        opened++;
      } catch {
        blocked++;
      }
    }
    recordOpen(normal.slice(0, opened).map((b) => b.id));
    return { opened, blocked, skippedPrivate: priv.length };
  }
  if (!api) {
    previewOpen({ kind: 'group', group, normal: normal.length, priv: priv.length });
    return { opened: bms.length, skippedPrivate: 0 };
  }

  let opened = 0;
  let skippedPrivate = 0;
  const gd = groupDefaults(doc, group);

  if (normal.length) {
    const urls = normal.map((b) => b.url);
    let tabIds = [];
    let windowId;
    if (group.openAllIn === 'window' || gd.mode === 'window' || gd.mode === 'app') {
      const win = await api.windows.create({ url: urls, focused: true });
      windowId = win.id;
      tabIds = (win.tabs || []).map((t) => t.id);
    } else {
      windowId = fromTab ? fromTab.windowId : (await api.windows.getLastFocused({ windowTypes: ['normal'] })).id;
      for (let i = 0; i < urls.length; i++) {
        const t = await api.tabs.create({ windowId, url: urls[i], active: i === 0 });
        tabIds.push(t.id);
      }
    }
    await groupTabs(tabIds, windowId, group);
    await track(normal.map((b, i) => [b.id, tabIds[i]]));
    opened += normal.length;
  }

  if (priv.length) {
    if (await incognitoAllowed()) {
      const urls = priv.map((b) => b.url);
      const existing = await existingIncognitoWindow();
      let tabIds = [];
      let windowId;
      if (existing) {
        windowId = existing.id;
        for (let i = 0; i < urls.length; i++) {
          const t = await api.tabs.create({ windowId, url: urls[i], active: i === 0 });
          tabIds.push(t.id);
        }
        await api.windows.update(windowId, { focused: true });
      } else {
        const win = await api.windows.create({ url: urls, incognito: true, focused: true });
        windowId = win.id;
        tabIds = (win.tabs || []).map((t) => t.id);
      }
      await groupTabs(tabIds, windowId, group);
      await track(priv.map((b, i) => [b.id, tabIds[i]]));
      opened += priv.length;
    } else {
      skippedPrivate = priv.length;
    }
  }

  recordOpen([...normal, ...(skippedPrivate ? [] : priv)].map((b) => b.id));
  return { opened, skippedPrivate };
}

async function groupTabs(tabIds, windowId, group) {
  if (!tabIds.length || !api.tabs.group || !api.tabGroups) return;
  try {
    const gid = await api.tabs.group({ tabIds, createProperties: { windowId } });
    await api.tabGroups.update(gid, { title: group.name, color: group.color, collapsed: false });
  } catch {
    // Tab groups are a nicety; the tabs are already open.
  }
}

// Finds an open Shelfmark tab or opens one. A string prefills the search;
// { edit: id } opens that bookmark's editor.
export async function openAppTab(arg = '') {
  if (!api) return;
  const base = api.runtime.getURL('app.html');
  const params = new URLSearchParams();
  if (typeof arg === 'string' && arg) params.set('q', arg);
  if (arg && typeof arg === 'object' && arg.edit) params.set('edit', arg.edit);
  const qs = params.toString();
  const url = qs ? base + '?' + qs : base;
  // Only reuse a Shelfmark tab in the window you're working in, so it never jumps
  // to another window or display. Extra Shelfmark tabs stay in sync with each other.
  let win = null;
  try {
    win = await api.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch { /* no normal window yet */ }
  if (win && win.incognito) win = null; // extension pages can't open in incognito windows
  const tabs = win ? await api.tabs.query({ windowId: win.id }) : [];
  const existing = tabs.find((t) => (t.url || '').startsWith(base));
  if (existing) {
    await api.tabs.update(existing.id, qs ? { active: true, url } : { active: true });
    return existing;
  }
  return api.tabs.create(win ? { url, windowId: win.id } : { url });
}

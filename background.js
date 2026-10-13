// Background (a service worker in Chrome and Edge, an event page in Firefox):
// right-click menu, address-bar keyword, keyboard command, opening at start-up.

import { loadDoc, mutate, loadStats, recordOpen, DOC_KEY } from './lib/store.js';
import { newGroup, newBookmark, findByUrl, groupOf, fallbackTitle, displayHost, MODES, effective, isValidUrl, widgetOn } from './lib/model.js';
import { searchDoc } from './lib/search.js';
import { evaluate } from './lib/calc.js';
import { openUrl, openAppTab, OpenError } from './lib/open.js';
import { ext, B } from './lib/browser.js';

// --- right-click "Save to Shelfmark" ------------------------------------------
const MENU_ROOT = 'sm-root';
const MENU_GROUP = 'sm-group:';
const MENU_NEW = 'sm-new';
const MENU_OPEN = 'sm-open';

let menuTimer = null;
function scheduleMenus() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(rebuildMenus, 150);
}

async function rebuildMenus() {
  const doc = await loadDoc();
  await ext.contextMenus.removeAll();
  const contexts = ['page', 'link'];
  ext.contextMenus.create({ id: MENU_ROOT, title: 'Save to Shelfmark', contexts });
  for (const g of doc.groups) {
    ext.contextMenus.create({ id: MENU_GROUP + g.id, parentId: MENU_ROOT, title: g.name.replace(/&/g, '&&'), contexts });
  }
  if (doc.groups.length) ext.contextMenus.create({ id: 'sm-sep', parentId: MENU_ROOT, type: 'separator', contexts });
  ext.contextMenus.create({ id: MENU_NEW, parentId: MENU_ROOT, title: 'New group "Saved"', contexts });
  ext.contextMenus.create({ id: MENU_OPEN, parentId: MENU_ROOT, title: 'Open Shelfmark', contexts });
}

async function flashBadge(tabId, ok = true) {
  try {
    await ext.action.setBadgeBackgroundColor({ tabId, color: ok ? '#2457C5' : '#B3261E' });
    await ext.action.setBadgeText({ tabId, text: ok ? '✓' : '!' });
    setTimeout(() => ext.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2500);
  } catch { /* tab may be gone */ }
}

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_OPEN) return openAppTab();
  const url = info.linkUrl || info.pageUrl || (tab && tab.url);
  if (!url || !isValidUrl(url)) return tab && flashBadge(tab.id, false);
  const title = info.linkUrl
    ? (info.linkText || info.selectionText || '').trim() || fallbackTitle(url)
    : (tab && tab.title) || fallbackTitle(url);

  await mutate((doc) => {
    let group;
    if (info.menuItemId === MENU_NEW) {
      group = doc.groups.find((g) => g.name === 'Saved');
      if (!group) {
        group = newGroup('Saved', 'blue');
        doc.groups.push(group);
      }
    } else if (String(info.menuItemId).startsWith(MENU_GROUP)) {
      group = doc.groups.find((g) => g.id === String(info.menuItemId).slice(MENU_GROUP.length));
    }
    if (!group) return;
    const existing = findByUrl(doc, url);
    if (existing && groupOf(doc, existing.id) === group) return; // already there
    const bm = newBookmark({ url, title });
    doc.bookmarks[bm.id] = bm;
    group.items.push(bm.id);
  });
  if (tab) flashBadge(tab.id, true);
});

// --- address-bar keyword: type "bm" then a space -----------------------------
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Chrome and Edge style suggestions with <match>/<url>/<dim>; Firefox shows plain text.
const tag = (name, text) => (B.richOmnibox ? `<${name}>${esc(text)}</${name}>` : text);

function describe(doc, bm) {
  const g = groupOf(doc, bm.id);
  const eff = effective(doc, bm, g);
  const extras = [g ? g.name : '', eff.mode !== 'tab' ? MODES[eff.mode].label.toLowerCase() : ''].filter(Boolean).join(', ');
  const title = bm.title || fallbackTitle(bm.url);
  if (!B.richOmnibox) return `${title} — ${displayHost(bm.url)}${extras ? ` (${extras})` : ''}`;
  return `${tag('match', title)} ${tag('url', displayHost(bm.url))}${extras ? ` ${tag('dim', extras)}` : ''}`;
}

ext.omnibox.onInputStarted.addListener(() => {
  ext.omnibox.setDefaultSuggestion({ description: 'Search Shelfmark bookmarks' });
});

ext.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const doc = await loadDoc();
  const stats = await loadStats();
  const hits = searchDoc(doc, text, stats).slice(0, 7);
  if (!text.trim()) {
    ext.omnibox.setDefaultSuggestion({ description: 'Search Shelfmark bookmarks' });
    return suggest([]);
  }
  // A sum shows its answer right in the address bar; Enter opens Shelfmark to copy it.
  const sum = widgetOn(doc.settings, 'calc') ? evaluate(text) : null;
  if (sum && !sum.error) {
    ext.omnibox.setDefaultSuggestion({ description: `${B.richOmnibox ? esc(sum.expr) : sum.expr} = ${tag('match', sum.text)}  ${tag('dim', 'Enter to copy it in Shelfmark')}` });
    return suggest([]);
  }
  if (!hits.length) {
    ext.omnibox.setDefaultSuggestion({ description: `No bookmarks match ${tag('match', text)}. Press Enter to search in Shelfmark.` });
    return suggest([]);
  }
  ext.omnibox.setDefaultSuggestion({ description: describe(doc, doc.bookmarks[hits[0].id]) });
  suggest(hits.slice(1).map((h) => ({ content: doc.bookmarks[h.id].url, description: describe(doc, doc.bookmarks[h.id]) })));
});

ext.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const doc = await loadDoc();
  if (widgetOn(doc.settings, 'calc')) {
    const sum = evaluate(text);
    if (sum && !sum.error) return openAppTab(text);
  }
  const stats = await loadStats();
  const top = searchDoc(doc, text, stats)[0];
  const bm = findByUrl(doc, text) || (top && doc.bookmarks[top.id]);
  if (!bm) return openAppTab(text);

  const eff = effective(doc, bm);
  // Private, window and app modes always win. Otherwise follow how Enter was pressed
  // (plain Enter replaces the current tab, Alt+Enter opens a new one).
  let mode = eff.mode;
  if (!['private', 'window', 'app'].includes(mode)) {
    mode = disposition === 'newForegroundTab' ? 'tab' : disposition === 'newBackgroundTab' ? 'background' : 'current';
  }
  const [active] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  try {
    await openUrl(bm.url, { mode, reuse: eff.reuse, fromTab: active || null, bookmarkId: bm.id });
    recordOpen(bm.id);
  } catch (err) {
    if (err instanceof OpenError && err.code === 'incognito-denied') {
      // Can't open privately; send them somewhere that explains why.
      openAppTab(text);
    }
  }
});

// --- keyboard command ---------------------------------------------------------
ext.commands.onCommand.addListener((command) => {
  if (command === 'open-app') openAppTab();
});

// --- open Shelfmark when the browser starts ----------------------------------------
// Runs on browser start-up, and when the first window opens after all were closed
// (the browser can keep running in the background without windows). It reuses a Shelfmark
// tab if one is there, takes over the empty new tab the browser opens, or else adds
// Shelfmark in front of any tabs it restored.
let launching = null;

function isBlankNewTab(t) {
  return B.newTab.test(t.pendingUrl || t.url || '');
}

async function openOnLaunch(windowId = null) {
  const doc = await loadDoc();
  if (!doc.settings.openOnStartup) return;
  if (launching) return launching;
  launching = (async () => {
    await new Promise((r) => setTimeout(r, 700)); // let the browser finish restoring tabs
    const wins = (await ext.windows.getAll({ windowTypes: ['normal'], populate: true })).filter((w) => !w.incognito);
    const win = wins.find((w) => w.id === windowId) || wins.find((w) => w.focused) || wins[0];
    if (!win) return;
    const base = ext.runtime.getURL('app.html');
    const existing = win.tabs.find((t) => (t.url || t.pendingUrl || '').startsWith(base));
    if (existing) {
      await ext.tabs.update(existing.id, { active: true });
      return;
    }
    const blank = win.tabs.find(isBlankNewTab);
    if (blank) {
      await ext.tabs.update(blank.id, { url: base, active: true });
      return;
    }
    await ext.tabs.create({ windowId: win.id, url: base, index: 0, active: true });
  })();
  try {
    await launching;
  } finally {
    launching = null;
  }
}

ext.runtime.onStartup.addListener(() => openOnLaunch());
ext.windows.onCreated.addListener(async (w) => {
  if (w.incognito || (w.type && w.type !== 'normal')) return;
  const normal = (await ext.windows.getAll({ windowTypes: ['normal'] })).filter((x) => !x.incognito);
  if (normal.length === 1) openOnLaunch(w.id);
});

// --- lifecycle ---------------------------------------------------------------
ext.runtime.onInstalled.addListener(async (details) => {
  await rebuildMenus();
  if (details.reason === 'install') openAppTab();
});
ext.runtime.onStartup.addListener(rebuildMenus);
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[DOC_KEY]) scheduleMenus();
});

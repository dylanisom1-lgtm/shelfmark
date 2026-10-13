// Shelfmark main page: state, events, dialogs. Markup for each layout lives in views.js.

import {
  MODES, MODE_ORDER, COLORS, COLOR_LABELS, emptyDoc, groupDefaults, groupOf,
  newGroup, newBookmark, nextColor, cleanUrl, isValidUrl, displayHost, fallbackTitle, findByUrl, clone, widgetOn,
} from '../lib/model.js';
import {
  loadDoc, loadStats, mutate, onStoreChange, replaceDoc, replaceStats, getKey, setKey, recordOpen,
  loadWidgetData, replaceWidgetData, IS_EXTENSION, IS_WEB, STORAGE_AVAILABLE,
} from '../lib/store.js';
import { searchDoc } from '../lib/search.js';
import { evaluate } from '../lib/calc.js';
import { openBookmark, openGroup, incognitoAllowed, OpenError } from '../lib/open.js';
import { ext, B, MODE, siteBase, lowerFirst, canOpenExtensionSettings, canOpenShortcutSettings, openExtensionSettings, openShortcutSettings } from '../lib/browser.js';
import { ICONS } from '../lib/icons.js';
import { exportPayload, backupFilename, downloadJson, parseImportText, mergeInto, summarize } from '../lib/importers.js';
import { escHtml, modeLabel, setIconSource } from './ui.js';
import { VIEWS, LAYOUTS, SORTS, layoutPickerHtml } from './views.js';
import { createSetup } from './setup.js';
import { createWidgetPanel, WIDGETS } from './widgets.js';
import { ago as agoText } from './wkit.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const VIEW_KEY = 'shelfmark.view';
const DRAG_LAYOUTS = ['columns', 'list', 'tiles', 'sidebar'];

const state = {
  cols: 0,
  doc: emptyDoc(),
  stats: {},
  query: '',
  editing: false,
  incognitoOK: true,
  bestId: null,
  results: [],
  calc: null, // the calculator's answer to the current search, if it's a sum
  view: { sidebarGroup: null, sort: { key: 'arrange', dir: 1 } }, // per-browser view state
  selected: new Set(), // table selection
};

const grid = $('#grid');
const searchInput = $('#q');
const layout = () => state.doc.settings.layout;
const panel = createWidgetPanel({ root: $('#widgets'), toast, copyText, onAlerts: setAlerts });

// --- alerts from live widgets (outages) ----------------------------------------------
const alertSets = new Map();
function setAlerts(widgetId, list) {
  alertSets.set(widgetId, list);
  renderAlerts();
}
function renderAlerts() {
  const el = $('#alerts');
  const all = [...alertSets.entries()].flatMap(([wid, list]) => list.map((a) => ({ ...a, wid })));
  el.hidden = !all.length || !state.doc.settings.setupDone;
  el.innerHTML = all
    .map(
      (a) => `<div class="alert lvl-${a.level}">
        <span class="st-dot" aria-hidden="true"></span>
        <p><strong>${escHtml(a.name)}</strong> ${a.level === 'down' ? 'outage' : 'problem'}: ${escHtml(a.text)}${
          a.more ? ` <span class="alert-meta">and ${a.more} more</span>` : ''
        }${a.state || a.updated ? ` <span class="alert-meta">${[a.state, a.updated ? agoText(a.updated) : ''].filter(Boolean).map(escHtml).join(' · ')}</span>` : ''}</p>
        <a class="btn small" href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">Details</a>
        <button type="button" class="icon-btn" data-dismiss="${escHtml(a.wid)}|${escHtml(a.key)}|${escHtml(a.sig)}" aria-label="Dismiss the ${escHtml(a.name)} alert until it changes" title="Dismiss until it changes">${ICONS.close}</button>
      </div>`,
    )
    .join('');
}
$('#alerts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dismiss]');
  if (!b) return;
  const [wid, key, ...rest] = b.dataset.dismiss.split('|');
  panel.dismiss(wid, key, rest.join('|'));
});

function usesPrivate(doc) {
  if (doc.settings.defaultMode === 'private') return true;
  if (doc.groups.some((g) => g.mode === 'private')) return true;
  return Object.values(doc.bookmarks).some((b) => b.mode === 'private');
}

function setIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (ICONS[name]) el.outerHTML = ICONS[name];
  });
}

function saveView() {
  setKey(VIEW_KEY, state.view).catch(() => {});
}

// --- rendering ----------------------------------------------------------------
function applyTheme() {
  const t = state.doc.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function applyBodyClasses() {
  const b = document.body.classList;
  [...b].filter((c) => c.startsWith('layout-') || c.startsWith('density-')).forEach((c) => b.remove(c));
  b.add('layout-' + layout(), 'density-' + state.doc.settings.density);
}

function renderNotice() {
  const el = $('#notice');
  if (IS_WEB && !STORAGE_AVAILABLE) {
    el.hidden = false;
    el.innerHTML = `${ICONS.warn}<p>This browser is blocking storage for this site, so changes won’t be kept after you close the tab. Allow site data for this address, or export a backup before you leave.</p>`;
    return;
  }
  const show = IS_EXTENSION && !state.incognitoOK && usesPrivate(state.doc) && state.doc.settings.setupDone;
  el.hidden = !show;
  if (!show) return;
  el.innerHTML = `${ICONS.private}<p>Private-window bookmarks need one ${escHtml(B.name)} setting. ${escHtml(B.settingsHow)}. Until then, those links are copied instead of opened.</p>${
    canOpenExtensionSettings ? `<button type="button" class="btn" data-open-ext>Open Shelfmark's settings</button>` : ''
  }`;
}

const COL_MIN = 300;
const COL_GAP = 16;
function columnCount() {
  const cs = getComputedStyle(grid);
  const w = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (!(w > 0)) return state.cols || 3;
  return Math.max(1, Math.floor((w + COL_GAP) / (COL_MIN + COL_GAP)));
}
new ResizeObserver(() => {
  if (layout() === 'columns' && !drag && !grid.hidden && columnCount() !== state.cols) render();
}).observe(grid);

function render() {
  applyTheme();
  applyBodyClasses();
  setIconSource(state.doc.settings.siteIcons);
  const doc = state.doc;

  if (!doc.settings.setupDone) {
    $('#empty').hidden = true;
    $('#notice').hidden = true;
    grid.hidden = true;
    panel.render(doc.settings, { show: false });
    setup.show();
    return;
  }
  if (setup.visible) setup.hide();
  renderNotice();
  panel.render(doc.settings);
  renderAlerts();
  const calcOn = widgetOn(doc.settings, 'calc');
  searchInput.placeholder = calcOn ? 'Search bookmarks, or type a sum' : 'Search bookmarks';

  const lay = layout();
  const q = state.query.trim();
  const active = document.activeElement;
  const focusedId = active && active.classList && active.classList.contains('link') ? active.dataset.id : null;
  const focusedNav = active && active.classList && active.classList.contains('navbtn') ? active.closest('.navitem').dataset.gid : null;

  let matches = null;
  state.results = [];
  if (q) {
    state.results = searchDoc(doc, q, state.stats);
    matches = new Map(state.results.map((r) => [r.id, r]));
  }
  // A sum takes Enter (to copy its answer), so no bookmark is marked as the Enter target.
  state.calc = q && calcOn ? evaluate(q) : null;
  const calcOk = !!(state.calc && !state.calc.error);
  state.bestId = state.results.length && !calcOk ? state.results[0].id : null;
  const answer = state.calc ? answerHtml(state.calc, q) : '';

  const editing = state.editing && lay !== 'launcher';
  $('#edit-btn').hidden = lay === 'launcher';
  const empty = !doc.groups.length && !q;
  $('#empty').hidden = !empty;
  grid.hidden = empty;
  grid.className = `grid view-${lay}${editing ? ' editing' : ''}${editing && !q && DRAG_LAYOUTS.includes(lay) ? ' can-drag' : ''}`;
  if (empty) {
    grid.innerHTML = '';
    return;
  }
  if (q && !state.results.length) {
    grid.innerHTML = answer || `<p class="no-results">Nothing matches <strong>${escHtml(q)}</strong>. Search covers names, sites, tags, notes, group names and how links open (try “private”).</p>`;
    return;
  }

  const ctx = { doc, stats: state.stats, matches, results: state.results, bestId: state.bestId, editing, q };
  const env = {
    cols: lay === 'columns' ? columnCount() : 1,
    rowH: doc.settings.density === 'compact' ? 27 : 32,
    sidebarGroup: state.view.sidebarGroup,
    sort: state.view.sort,
    selected: state.selected,
  };
  const out = VIEWS[lay](ctx, env);
  if (lay === 'columns') {
    state.cols = out.cols;
    grid.style.setProperty('--cols', out.cols);
  }
  if (out.selectedId && out.selectedId !== state.view.sidebarGroup) {
    state.view.sidebarGroup = out.selectedId;
    saveView();
  }
  grid.innerHTML = answer + out.html;

  if (focusedId) {
    const el = grid.querySelector(`a.link[data-id="${focusedId}"]`);
    if (el) el.focus({ preventScroll: true });
  } else if (focusedNav) {
    const el = grid.querySelector(`.navitem[data-gid="${focusedNav}"] .navbtn`);
    if (el) el.focus({ preventScroll: true });
  }
}

function answerHtml(c, q) {
  if (c.error) {
    return `<div class="answer error" role="status"><span class="answer-expr">${escHtml(q)}</span><span class="answer-error">${escHtml(c.error)}</span></div>`;
  }
  return `<div class="answer" role="status">
    <span class="answer-expr">${escHtml(c.expr)} =</span>
    <button type="button" class="answer-val" data-act="copy-answer" title="Copy">${escHtml(c.text)}</button>
    ${c.alt ? `<span class="answer-alt">${escHtml(c.alt)}</span>` : ''}
    <span class="answer-hint"><kbd>Enter</kbd> copies</span>
  </div>`;
}

async function copyAnswer() {
  const c = state.calc;
  if (!c || c.error) return;
  const ok = await copyText(c.copy);
  toast(ok ? `Copied ${c.copy}` : 'Couldn’t copy. Select the answer and copy it instead.');
}

// Broken favicons fall back to a lettered tile.
grid.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav')) return;
    const span = document.createElement('span');
    span.className = 'fav mono';
    span.style.setProperty('--h', img.dataset.h || '210');
    span.textContent = img.dataset.mono || '?';
    span.setAttribute('aria-hidden', 'true');
    img.replaceWith(span);
  },
  true,
);

// --- toasts -------------------------------------------------------------------
function toast(message, { action, onAction, timeout = 5200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<p></p>`;
  el.querySelector('p').textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => {
      onAction && onAction();
      el.remove();
    });
    el.appendChild(b);
  }
  const wrap = $('#toasts');
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  setTimeout(() => el.remove(), timeout);
}

// --- opening ------------------------------------------------------------------
// Looked up on every open, not cached at load: the Shelfmark tab can be dragged to
// another window, and new tabs should land beside it wherever it is now.
async function currentTab() {
  if (!IS_EXTENSION) return null;
  try {
    return (await ext.tabs.getCurrent()) || null;
  } catch {
    return null;
  }
}

function overrideFromEvent(e) {
  if (e.altKey) return 'private';
  if (e.shiftKey) return 'window';
  if (e.ctrlKey || e.metaKey) return 'background';
  return null;
}

async function launch(id, override = null) {
  try {
    const r = await openBookmark(state.doc, id, { override, fromTab: await currentTab() });
    // On the website, browsers may refuse to bring another tab forward. If this page is
    // still in front, say where the link is instead of looking like nothing happened.
    if (IS_WEB && r && r.reused) {
      setTimeout(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) toast('That page is already open in another tab.');
      }, 250);
    }
  } catch (err) {
    handleOpenError(err, state.doc.bookmarks[id]);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function handleOpenError(err, bm) {
  if (err instanceof OpenError && err.code === 'private-unsupported') {
    const copied = await copyText(bm.url);
    toast(
      copied
        ? `Link copied. A website can’t open private windows, so paste it into one (${B.privateKeys}).`
        : `A website can’t open private windows. Open one with ${B.privateKeys} and go to ${bm.url}`,
      { timeout: 9000 },
    );
    return;
  }
  if (err instanceof OpenError && err.code === 'blocked') {
    toast('Your browser blocked the new tab. Allow pop-ups for this site, then try again.', { timeout: 9000 });
    return;
  }
  if (err instanceof OpenError && err.code === 'incognito-denied') {
    state.incognitoOK = false;
    renderNotice();
    let copied = false;
    try {
      await navigator.clipboard.writeText(bm.url);
      copied = true;
    } catch { /* clipboard may be unavailable */ }
    const how = canOpenExtensionSettings ? '' : ` To allow them, ${lowerFirst(B.settingsHow)}.`;
    toast(
      (copied
        ? 'Private windows are off for Shelfmark, so the link was copied. Paste it into a private window.'
        : 'Private windows are off for Shelfmark.') + how,
      canOpenExtensionSettings ? { action: 'Turn on', onAction: openExtensionSettings, timeout: 8000 } : { timeout: 10000 },
    );
    return;
  }
  toast(`Couldn't open that link: ${err && err.message ? err.message : 'unknown error'}`);
}

async function launchGroup(gid) {
  const g = state.doc.groups.find((x) => x.id === gid);
  if (!g || !g.items.length) return;
  if (g.items.length > 12) {
    const ok = await confirmDialog(`Open all ${g.items.length} bookmarks in “${g.name}”?`, 'Open all');
    if (!ok) return;
  }
  try {
    const r = await openGroup(state.doc, gid, { fromTab: await currentTab() });
    if (IS_WEB) {
      const parts = [];
      if (r.blocked) parts.push(`Opened ${r.opened} of ${r.opened + r.blocked}. Your browser blocked the rest; allow pop-ups for this site to open whole groups.`);
      if (r.skippedPrivate) parts.push(`${r.skippedPrivate} private bookmark${r.skippedPrivate > 1 ? 's were' : ' was'} left out, because a website can’t open private windows.`);
      if (parts.length) toast(parts.join(' '), { timeout: 10000 });
      return;
    }
    if (r.skippedPrivate) {
      state.incognitoOK = false;
      renderNotice();
      const msg = `${r.skippedPrivate} private bookmark${r.skippedPrivate > 1 ? 's were' : ' was'} skipped because private windows are off for Shelfmark.`;
      toast(
        canOpenExtensionSettings ? msg : `${msg} To allow them, ${lowerFirst(B.settingsHow)}.`,
        canOpenExtensionSettings ? { action: 'Turn on', onAction: openExtensionSettings, timeout: 8000 } : { timeout: 10000 },
      );
    }
  } catch (err) {
    toast(`Couldn't open the group: ${err.message}`);
  }
}

// --- editing helpers ----------------------------------------------------------
async function commit(fn, { quiet = false } = {}) {
  const { doc, result } = await mutate(fn);
  state.doc = doc;
  if (!quiet) render();
  return result;
}

async function deleteWithUndo(id) {
  const bm = state.doc.bookmarks[id];
  if (!bm) return;
  const g = groupOf(state.doc, id);
  const snapshot = clone(bm);
  const gid = g ? g.id : null;
  const index = g ? g.items.indexOf(id) : 0;
  await commit((doc) => {
    const gg = groupOf(doc, id);
    if (gg) gg.items = gg.items.filter((x) => x !== id);
    delete doc.bookmarks[id];
  });
  state.selected.delete(id);
  toast(`Deleted “${snapshot.title || fallbackTitle(snapshot.url)}”`, {
    action: 'Undo',
    onAction: () =>
      commit((doc) => {
        let target = doc.groups.find((x) => x.id === gid) || doc.groups[0];
        if (!target) {
          target = newGroup('Bookmarks', 'blue');
          doc.groups.push(target);
        }
        doc.bookmarks[snapshot.id] = snapshot;
        target.items.splice(Math.min(index, target.items.length), 0, snapshot.id);
      }),
  });
}

async function deleteGroupWithUndo(gid) {
  const g = state.doc.groups.find((x) => x.id === gid);
  if (!g) return;
  const index = state.doc.groups.indexOf(g);
  const snapGroup = clone(g);
  const snapBms = g.items.map((id) => clone(state.doc.bookmarks[id]));
  await commit((doc) => {
    const gg = doc.groups.find((x) => x.id === gid);
    if (!gg) return;
    gg.items.forEach((id) => delete doc.bookmarks[id]);
    doc.groups = doc.groups.filter((x) => x.id !== gid);
  });
  const n = snapBms.length;
  toast(`Deleted “${snapGroup.name}”${n ? ` and its ${n} bookmark${n > 1 ? 's' : ''}` : ''}`, {
    action: 'Undo',
    onAction: () =>
      commit((doc) => {
        snapBms.forEach((b) => (doc.bookmarks[b.id] = b));
        doc.groups.splice(Math.min(index, doc.groups.length), 0, snapGroup);
      }),
  });
}

async function moveWithinGroup(id, delta) {
  const g = groupOf(state.doc, id);
  if (!g) return;
  const i = g.items.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= g.items.length) return;
  await commit((doc) => {
    const gg = groupOf(doc, id);
    const a = gg.items.indexOf(id);
    const b = a + delta;
    if (b < 0 || b >= gg.items.length) return;
    [gg.items[a], gg.items[b]] = [gg.items[b], gg.items[a]];
  });
  const el = grid.querySelector(`a.link[data-id="${id}"]`);
  if (el) el.focus();
}

// --- table: selection and bulk changes ----------------------------------------
function shownIds() {
  return $$('tr.trow', grid).map((tr) => tr.dataset.id);
}

async function bulkApply(kind, value) {
  const ids = [...state.selected].filter((id) => state.doc.bookmarks[id]);
  if (!ids.length || !value) return;
  const before = clone(state.doc);
  let msg = '';
  await commit((doc) => {
    if (kind === 'move') {
      const to = doc.groups.find((g) => g.id === value);
      if (!to) return;
      for (const id of ids) {
        const from = groupOf(doc, id);
        if (from === to) continue;
        if (from) from.items = from.items.filter((x) => x !== id);
        to.items.push(id);
      }
      msg = `Moved ${ids.length} to “${to.name}”`;
    }
    if (kind === 'mode') {
      ids.forEach((id) => (doc.bookmarks[id].mode = value === '__inherit' ? null : value));
      const where = { tab: 'in a new tab', background: 'in a background tab', current: 'in the same tab', window: 'in a new window', private: 'in a private window', app: 'in an app window' };
      const n = `${ids.length} bookmark${ids.length === 1 ? '' : 's'}`;
      msg = value === '__inherit' ? `${n} now follow their group setting` : `${n} now open ${where[value]}`;
    }
    if (kind === 'reuse') {
      ids.forEach((id) => (doc.bookmarks[id].reuse = value === '__inherit' ? null : value === 'true'));
      msg = `Updated ${ids.length} bookmark${ids.length === 1 ? '' : 's'}`;
    }
  });
  toast(msg, { action: 'Undo', onAction: () => restoreDoc(before) });
}

async function bulkDelete() {
  const ids = [...state.selected].filter((id) => state.doc.bookmarks[id]);
  if (!ids.length) return;
  const before = clone(state.doc);
  await commit((doc) => {
    for (const id of ids) {
      const g = groupOf(doc, id);
      if (g) g.items = g.items.filter((x) => x !== id);
      delete doc.bookmarks[id];
    }
  });
  state.selected.clear();
  render();
  toast(`Deleted ${ids.length} bookmark${ids.length === 1 ? '' : 's'}`, { action: 'Undo', onAction: () => restoreDoc(before) });
}

async function restoreDoc(doc) {
  await replaceDoc(doc);
  state.doc = await loadDoc();
  render();
}

// --- keyboard navigation ------------------------------------------------------
function visibleLinks() {
  return $$('a.link', grid);
}

function focusLink(el) {
  if (!el) return;
  el.focus();
  el.scrollIntoView({ block: 'nearest' });
}

// For grids of tiles: the nearest link in the row above or below.
function spatialVertical(from, links, dir) {
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cands = links
    .filter((l) => l !== from)
    .map((l) => {
      const lr = l.getBoundingClientRect();
      return { l, dy: (lr.top + lr.height / 2 - (r.top + r.height / 2)) * dir, dx: Math.abs(lr.left + lr.width / 2 - cx) };
    })
    .filter((c) => c.dy > r.height / 2);
  if (!cands.length) return null;
  const minDy = Math.min(...cands.map((c) => c.dy));
  return cands.filter((c) => c.dy <= minDy + 8).sort((a, b) => a.dx - b.dx)[0].l;
}

function moveFocus(from, key) {
  const lay = layout();
  const links = visibleLinks();
  const i = links.indexOf(from);
  if (key === 'Home') return focusLink(links[0]);
  if (key === 'End') return focusLink(links[links.length - 1]);

  if (lay === 'tiles') {
    if (key === 'ArrowLeft') return focusLink(links[i - 1]);
    if (key === 'ArrowRight') return focusLink(links[i + 1]);
    const t = spatialVertical(from, links, key === 'ArrowUp' ? -1 : 1);
    if (t) return focusLink(t);
    if (key === 'ArrowUp') searchInput.focus();
    return;
  }

  if (key === 'ArrowDown') return focusLink(links[i + 1]);
  if (key === 'ArrowUp') return i === 0 ? searchInput.focus() : focusLink(links[i - 1]);

  if (lay === 'columns') {
    // Jump to the link in the neighboring column that sits closest to this one's height.
    const cols = $$('.col', grid).filter((c) => c.querySelector('a.link'));
    const target = cols[cols.indexOf(from.closest('.col')) + (key === 'ArrowRight' ? 1 : -1)];
    if (!target) return;
    const r = from.getBoundingClientRect();
    const y = r.top + r.height / 2;
    let best = null;
    let bestD = Infinity;
    for (const l of $$('a.link', target)) {
      const lr = l.getBoundingClientRect();
      const d = Math.abs(lr.top + lr.height / 2 - y);
      if (d < bestD) { bestD = d; best = l; }
    }
    return focusLink(best);
  }
  if (lay === 'list') {
    const groups = $$('.group', grid).filter((s) => s.querySelector('a.link'));
    const target = groups[groups.indexOf(from.closest('.group')) + (key === 'ArrowRight' ? 1 : -1)];
    if (target) focusLink(target.querySelector('a.link'));
    return;
  }
  if (lay === 'sidebar' && key === 'ArrowLeft') {
    const nav = grid.querySelector('.navitem.active .navbtn') || grid.querySelector('.navbtn');
    if (nav) nav.focus();
  }
}

function selectSidebarGroup(gid, { focusNav = false } = {}) {
  state.view.sidebarGroup = gid;
  saveView();
  if (state.query) setQuery('');
  else render();
  if (focusNav) {
    const el = grid.querySelector(`.navitem[data-gid="${gid}"] .navbtn`);
    if (el) el.focus();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  if (document.querySelector('dialog[open]')) return;
  if (setup.visible) return;
  const t = e.target;

  if (t === searchInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.calc && !state.calc.error) copyAnswer();
      else if (state.bestId) launch(state.bestId, overrideFromEvent(e));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const best = state.bestId && grid.querySelector(`a.link[data-id="${state.bestId}"]`);
      focusLink(best || visibleLinks()[0]);
    } else if (e.key === 'Escape') {
      if (searchInput.value) {
        e.preventDefault();
        setQuery('');
      } else {
        searchInput.blur();
      }
    }
    return;
  }

  if (t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (!$('#menu').hidden) return;

  // Sidebar group list
  if (t.classList && t.classList.contains('navbtn')) {
    const items = $$('.navbtn', grid);
    const i = items.indexOf(t);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) selectSidebarGroup(next.closest('.navitem').dataset.gid, { focusNav: true });
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusLink(grid.querySelector('.sb-main a.link'));
      return;
    }
  }

  if (t.classList && t.classList.contains('link')) {
    const id = t.dataset.id;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.editing && layout() !== 'launcher') openBookmarkDialog(id);
      else launch(id, overrideFromEvent(e));
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (!state.query && !['table', 'launcher'].includes(layout())) moveWithinGroup(id, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      moveFocus(t, e.key);
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      openBookmarkDialog(id);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      const links = visibleLinks();
      const next = links[links.indexOf(t) + 1] || links[links.indexOf(t) - 1];
      const nextId = next && next.dataset.id;
      deleteWithUndo(id).then(() => {
        const el = nextId && grid.querySelector(`a.link[data-id="${nextId}"]`);
        if (el) el.focus();
      });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      searchInput.focus();
      return;
    }
  }

  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    openHelp();
    return;
  }
  if (e.key === 'Escape' && state.editing) {
    setEditing(false);
    return;
  }
  // Type anywhere to search.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
    e.preventDefault();
    searchInput.focus();
    searchInput.value += e.key;
    setQuery(searchInput.value);
  }
});

function setQuery(q) {
  state.query = q;
  if (searchInput.value !== q) searchInput.value = q;
  searchInput.parentElement.classList.toggle('has-value', !!q);
  render();
}

searchInput.addEventListener('input', () => setQuery(searchInput.value));

// --- clicks on the grid -------------------------------------------------------
let suppressClick = false;

grid.addEventListener('click', (e) => {
  if (suppressClick) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    const key = sortBtn.dataset.sort;
    const cur = state.view.sort;
    state.view.sort = cur.key === key ? { key, dir: -cur.dir } : { key, dir: SORTS[key].firstDir || 1 };
    saveView();
    return render();
  }

  const actEl = e.target.closest('[data-act]');
  const section = e.target.closest('.group');
  const gid = section && section.dataset.gid;

  if (actEl) {
    const act = actEl.dataset.act;
    const row = actEl.closest('.row');
    if (act === 'copy-answer') return copyAnswer();
    if (act === 'edit' && row) return openBookmarkDialog(row.dataset.id);
    if (act === 'collapse' && gid) {
      if (state.query || layout() === 'sidebar') return;
      return commit((doc) => {
        const g = doc.groups.find((x) => x.id === gid);
        if (g) g.collapsed = !g.collapsed;
      });
    }
    if (act === 'open-group' && gid) return launchGroup(gid);
    if (act === 'edit-group' && gid) return openGroupDialog(gid);
    if (act === 'add-here' && gid) return openBookmarkDialog(null, { groupId: gid });
    if (act === 'new-group') return openGroupDialog(null);
    if (act === 'select-group') return selectSidebarGroup(actEl.closest('.navitem').dataset.gid, { focusNav: true });
    if (act === 'sort-reset') {
      state.view.sort = { key: 'arrange', dir: 1 };
      saveView();
      return render();
    }
    if (act === 'select' && row) {
      const id = row.dataset.id;
      if (actEl.checked) state.selected.add(id);
      else state.selected.delete(id);
      render();
      const cb = grid.querySelector(`tr[data-id="${id}"] input[data-act="select"]`);
      if (cb) cb.focus();
      return;
    }
    if (act === 'select-all') {
      const ids = shownIds();
      const all = ids.every((id) => state.selected.has(id));
      ids.forEach((id) => (all ? state.selected.delete(id) : state.selected.add(id)));
      render();
      const cb = grid.querySelector('input[data-act="select-all"]');
      if (cb) cb.focus();
      return;
    }
    if (act === 'bulk-clear') {
      state.selected.clear();
      return render();
    }
    if (act === 'bulk-delete') return bulkDelete();
    return;
  }

  const link = e.target.closest('a.link');
  if (link) {
    const editingNow = state.editing && layout() !== 'launcher';
    // A website can't open background tabs or plain new windows itself, but the browser
    // does when you Ctrl-, Cmd- or Shift-click a link, so let those through.
    if (IS_WEB && !editingNow && (e.ctrlKey || e.metaKey || e.shiftKey) && !e.altKey) {
      recordOpen(link.dataset.id);
      return;
    }
    e.preventDefault();
    if (editingNow) return openBookmarkDialog(link.dataset.id);
    launch(link.dataset.id, overrideFromEvent(e));
  }
});

grid.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-bulk]');
  if (sel) bulkApply(sel.dataset.bulk, sel.value);
});

// Middle click opens in a background tab, through the same path as everything else.
grid.addEventListener('mousedown', (e) => {
  if (e.button === 1 && e.target.closest('a.link')) e.preventDefault();
});
grid.addEventListener('auxclick', (e) => {
  const link = e.target.closest('a.link');
  if (!link || e.button !== 1) return;
  if (IS_WEB) {
    if (state.editing) e.preventDefault();
    else recordOpen(link.dataset.id); // the browser opens it in a background tab
    return;
  }
  e.preventDefault();
  if (!state.editing) launch(link.dataset.id, 'background');
});
grid.addEventListener('dragstart', (e) => {
  if (state.editing) e.preventDefault();
});

// --- drag to reorder (edit mode) ------------------------------------------------
// Pointer events rather than HTML5 drag and drop, which behaves differently in Firefox.
// Rows can be dropped between rows, into a group, or (in Sidebar) onto a group name.
let drag = null;

grid.addEventListener('pointerdown', (e) => {
  if (!state.editing || state.query || e.button !== 0 || !DRAG_LAYOUTS.includes(layout())) return;
  if (e.target.closest('.gactions, .row-edit, .add-row, .new-group, input, select')) return;
  const row = e.target.closest('li.row');
  const nav = !row && e.target.closest('li.navitem');
  const head = !row && !nav && layout() !== 'sidebar' && e.target.closest('.ghead');
  const el = row || nav || (head && head.closest('.group'));
  if (!el) return;
  drag = { kind: row ? 'row' : nav ? 'nav' : 'group', el, x0: e.clientX, y0: e.clientY, started: false, dropNav: null };
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    startDrag(e);
  }
  moveDrag(e);
});

document.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.started) {
    finishDrag();
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }
  drag = null;
});
document.addEventListener('pointercancel', () => {
  if (drag && drag.started) cleanupDrag();
  drag = null;
});

function startDrag(e) {
  drag.started = true;
  const rect = drag.el.getBoundingClientRect();
  drag.dx = e.clientX - rect.left;
  drag.dy = e.clientY - rect.top;

  const ghost = drag.el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = rect.width + 'px';
  document.body.appendChild(ghost);
  drag.ghost = ghost;

  const ph = document.createElement(drag.kind === 'group' ? 'div' : 'li');
  ph.className = 'placeholder' + (drag.kind === 'group' ? ' group' : '') + (drag.kind === 'nav' ? ' navph' : '');
  ph.style.height = rect.height + 'px';
  if (drag.kind === 'group') ph.style.display = 'block';
  drag.el.after(ph);
  drag.ph = ph;
  drag.el.classList.add('drag-source');
  document.body.classList.add('dragging');
}

function setDropNav(navEl) {
  $$('.navitem.drop-target', grid).forEach((n) => n.classList.remove('drop-target'));
  drag.dropNav = navEl ? navEl.dataset.gid : null;
  if (navEl) navEl.classList.add('drop-target');
  drag.ph.style.visibility = navEl ? 'hidden' : '';
}

function moveDrag(e) {
  const { ghost, ph } = drag;
  ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;

  if (e.clientY < 70) window.scrollBy(0, -14);
  else if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 14);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under || !grid.contains(under)) return;

  if (drag.kind === 'row') {
    const navEl = under.closest('li.navitem');
    if (navEl) return setDropNav(navEl);
    if (drag.dropNav) setDropNav(null);
    const horizontal = layout() === 'tiles';
    const row = under.closest('li.row');
    if (row && row !== drag.el) {
      const r = row.getBoundingClientRect();
      const before = horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
      if (before) row.before(ph);
      else row.after(ph);
      return;
    }
    const section = under.closest('.group');
    if (section && !section.classList.contains('collapsed')) {
      const list = section.querySelector('.items');
      const rows = $$('li.row:not(.drag-source)', list);
      const last = rows[rows.length - 1];
      if (!rows.length || e.clientY > last.getBoundingClientRect().bottom) list.appendChild(ph);
      else if (e.clientY < rows[0].getBoundingClientRect().top) list.prepend(ph);
    }
    return;
  }

  if (drag.kind === 'nav') {
    const navEl = under.closest('li.navitem:not(.drag-source)');
    if (navEl) {
      const r = navEl.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) navEl.before(ph);
      else navEl.after(ph);
    }
    return;
  }

  const section = under.closest('.group:not(.drag-source)');
  if (section && section !== ph) {
    const r = section.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) section.before(ph);
    else section.after(ph);
    return;
  }
  const col = under.closest('.col');
  if (col && !section) {
    const kids = $$(':scope > .group:not(.drag-source)', col).filter((k) => k !== ph);
    const last = kids[kids.length - 1];
    if (!last || e.clientY > last.getBoundingClientRect().bottom) {
      const tile = col.querySelector(':scope > .new-group');
      if (tile) tile.before(ph);
      else col.appendChild(ph);
    }
  }
}

function cleanupDrag() {
  drag.ghost.remove();
  drag.ph.remove();
  drag.el.classList.remove('drag-source');
  $$('.navitem.drop-target', grid).forEach((n) => n.classList.remove('drop-target'));
  document.body.classList.remove('dragging');
}

function finishDrag() {
  const { kind, el, ph } = drag;
  if (kind === 'row') {
    const id = el.dataset.id;
    if (drag.dropNav) {
      const toGid = drag.dropNav;
      cleanupDrag();
      return commit((doc) => {
        const from = groupOf(doc, id);
        const to = doc.groups.find((g) => g.id === toGid);
        if (!to || from === to) return;
        if (from) from.items = from.items.filter((x) => x !== id);
        to.items.push(id);
      });
    }
    const list = ph.parentElement;
    const section = list && list.closest('.group');
    if (!section) return cleanupDrag();
    const toGid = section.dataset.gid;
    const index = $$('li.row:not(.drag-source), li.placeholder', list).indexOf(ph);
    cleanupDrag();
    return commit((doc) => {
      const from = groupOf(doc, id);
      const to = doc.groups.find((g) => g.id === toGid);
      if (!from || !to) return;
      from.items = from.items.filter((x) => x !== id);
      to.items.splice(Math.max(0, Math.min(index, to.items.length)), 0, id);
    });
  }

  // Groups (sections or sidebar names): place next to whichever group it was dropped beside.
  const gid = el.dataset.gid;
  const sib = (dir) => {
    let n = dir === 'next' ? ph.nextElementSibling : ph.previousElementSibling;
    while (n && !(n.dataset && n.dataset.gid && !n.classList.contains('drag-source') && n !== ph)) {
      n = dir === 'next' ? n.nextElementSibling : n.previousElementSibling;
    }
    return n ? n.dataset.gid : null;
  };
  const nextId = sib('next');
  const prevId = sib('prev');
  cleanupDrag();
  commit((doc) => {
    const i = doc.groups.findIndex((g) => g.id === gid);
    if (i < 0) return;
    const [g] = doc.groups.splice(i, 1);
    let at = doc.groups.length;
    if (nextId) at = doc.groups.findIndex((x) => x.id === nextId);
    else if (prevId) at = doc.groups.findIndex((x) => x.id === prevId) + 1;
    doc.groups.splice(at < 0 ? doc.groups.length : at, 0, g);
  });
}

// --- header controls --------------------------------------------------------
function setEditing(on) {
  state.editing = on;
  if (!on) state.selected.clear();
  const btn = $('#edit-btn');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? 'Done' : 'Edit';
  render();
}

$('#add-btn').addEventListener('click', () => openBookmarkDialog(null));
$('#edit-btn').addEventListener('click', () => setEditing(!state.editing));

const menu = $('#menu');
const menuBtn = $('#menu-btn');
function openMenu() {
  const r = menuBtn.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = r.bottom + 6 + 'px';
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
  menuBtn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
}
function closeMenu(refocus = false) {
  if (menu.hidden) return;
  menu.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
  if (refocus) menuBtn.focus();
}
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (menu.hidden) openMenu();
  else closeMenu();
});
document.addEventListener('click', (e) => {
  if (!menu.hidden && !menu.contains(e.target)) closeMenu();
});
menu.addEventListener('keydown', (e) => {
  const items = $$('button', menu);
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});

document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-menu]');
  if (m) {
    closeMenu();
    $$('dialog[open]').forEach((d) => d.close());
    const what = m.dataset.menu;
    if (what === 'layout') openLayoutDialog();
    if (what === 'import') openImportDialog();
    if (what === 'export') exportBackup();
    if (what === 'settings') openSettings();
    if (what === 'help') openHelp();
  }
  if (e.target.closest('[data-open-ext]')) openExtensionSettings();
  if (e.target.closest('[data-open-shortcuts]')) openShortcutSettings();
  if (e.target.closest('[data-run-setup]')) {
    $$('dialog[open]').forEach((d) => d.close());
    setEditing(false);
    setup.restart();
  }
  const emptyBtn = e.target.closest('[data-empty]');
  if (emptyBtn) {
    if (emptyBtn.dataset.empty === 'add') openBookmarkDialog(null);
    if (emptyBtn.dataset.empty === 'import') openImportDialog();
  }
});

// --- dialogs: shared behavior -----------------------------------------------
$$('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) d.close('cancel');
    // click on the backdrop
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) d.close('cancel');
    }
  });
});

function showError(dialog, msg) {
  const el = dialog.querySelector('.dlg-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function modeOptions(select, inheritLabel) {
  select.innerHTML =
    `<option value="">${escHtml(inheritLabel)}</option>` +
    MODE_ORDER.map((m) => `<option value="${m}">${escHtml(MODES[m].label)}</option>`).join('');
}

function reuseOptions(select, inheritLabel) {
  select.innerHTML = `<option value="">${escHtml(inheritLabel)}</option><option value="true">Switch to the open tab</option><option value="false">Open another copy</option>`;
}

const reuseText = (v) => (v ? 'switch to it' : 'open another');

// --- layout dialog --------------------------------------------------------------
const layoutDialog = $('#layout-dialog');

function markPicked(root) {
  $$('.lp-card', root).forEach((c) => c.classList.toggle('picked', c.querySelector('input').checked));
}

function openLayoutDialog() {
  const s = state.doc.settings;
  const holder = $('[data-layouts]', layoutDialog);
  holder.innerHTML = layoutPickerHtml(s.layout, 'layout');
  markPicked(holder);
  $$('input[name="density"]', layoutDialog).forEach((r) => (r.checked = r.value === s.density));
  layoutDialog.showModal();
  const cur = $('input[name="layout"]:checked', layoutDialog);
  if (cur) cur.focus();
}

layoutDialog.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'layout') {
    markPicked(layoutDialog);
    state.selected.clear();
    commit((doc) => (doc.settings.layout = t.value));
  }
  if (t.name === 'density') commit((doc) => (doc.settings.density = t.value));
});

// --- bookmark dialog --------------------------------------------------------
const bmDialog = $('#bm-dialog');
const bmForm = $('#bm-form');
let bmEditing = null;
let bmDupeWarned = null;

function refreshBmInheritLabels() {
  const f = bmForm.elements;
  const gid = f.group.value;
  const g = gid && gid !== '__new' ? state.doc.groups.find((x) => x.id === gid) : null;
  const gd = groupDefaults(state.doc, g);
  const modeVal = f.mode.value;
  const reuseVal = f.reuse.value;
  const from = g ? 'Group setting' : 'Default';
  modeOptions(f.mode, `${from} (${modeLabel(gd.mode)})`);
  reuseOptions(f.reuse, `${from} (${reuseText(gd.reuse)})`);
  f.mode.value = modeVal;
  f.reuse.value = reuseVal;
  $('[data-newgroup]', bmDialog).hidden = gid !== '__new';
}

function openBookmarkDialog(id, { groupId = null, url = '', title = '' } = {}) {
  const doc = state.doc;
  const bm = id ? doc.bookmarks[id] : null;
  bmEditing = bm ? bm.id : null;
  bmDupeWarned = null;
  const f = bmForm.elements;
  $('#bm-heading').textContent = bm ? 'Edit bookmark' : 'Add bookmark';
  $('[data-delete]', bmDialog).hidden = !bm;

  const preferred = groupId || (layout() === 'sidebar' ? state.view.sidebarGroup : null);
  const currentGroup = bm ? groupOf(doc, bm.id) : doc.groups.find((g) => g.id === preferred) || doc.groups[0] || null;
  f.group.innerHTML =
    doc.groups.map((g) => `<option value="${g.id}">${escHtml(g.name)}</option>`).join('') + `<option value="__new">New group…</option>`;
  f.group.value = currentGroup ? currentGroup.id : '__new';
  f.newGroup.value = doc.groups.length ? '' : 'Bookmarks';

  f.url.value = bm ? bm.url : url;
  f.title.value = bm ? bm.title : title;
  f.tags.value = bm ? bm.tags.join(', ') : '';
  f.notes.value = bm ? bm.notes : '';
  modeOptions(f.mode, '');
  reuseOptions(f.reuse, '');
  f.mode.value = bm && bm.mode ? bm.mode : '';
  f.reuse.value = bm && bm.reuse !== null ? String(bm.reuse) : '';
  refreshBmInheritLabels();
  showError(bmDialog, '');
  bmDialog.showModal();
  (bm ? f.title : f.url).focus();
}

bmForm.elements.group.addEventListener('change', refreshBmInheritLabels);
bmDialog.addEventListener('close', () => {
  if (bmDialog.returnValue !== 'save') savingFromBookmarklet = false;
});

bmForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = bmForm.elements;
  const url = cleanUrl(f.url.value);
  if (!url || !isValidUrl(url)) {
    showError(bmDialog, url ? 'That address isn’t valid. Check for typos.' : 'Enter an address.');
    f.url.focus();
    return;
  }
  let gid = f.group.value;
  const newName = f.newGroup.value.trim();
  if (gid === '__new' && !newName) {
    showError(bmDialog, 'Name the new group.');
    f.newGroup.focus();
    return;
  }
  const dupe = findByUrl(state.doc, url);
  if (dupe && dupe.id !== bmEditing && bmDupeWarned !== url) {
    const dg = groupOf(state.doc, dupe.id);
    bmDupeWarned = url;
    showError(bmDialog, `This address is already saved${dg ? ` in “${dg.name}”` : ''}. Save again to keep both.`);
    return;
  }

  const fields = {
    url,
    title: f.title.value.trim(),
    mode: f.mode.value || null,
    reuse: f.reuse.value === '' ? null : f.reuse.value === 'true',
    tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    notes: f.notes.value.trim(),
  };
  const editingId = bmEditing;
  bmDialog.close('save');

  await commit((doc) => {
    let target;
    if (gid === '__new') {
      target = newGroup(newName, nextColor(doc));
      doc.groups.push(target);
    } else {
      target = doc.groups.find((g) => g.id === gid);
    }
    if (!target) return;
    if (editingId && doc.bookmarks[editingId]) {
      Object.assign(doc.bookmarks[editingId], fields);
      const from = groupOf(doc, editingId);
      if (from !== target) {
        if (from) from.items = from.items.filter((x) => x !== editingId);
        target.items.push(editingId);
      }
    } else {
      const bm = newBookmark(fields);
      doc.bookmarks[bm.id] = bm;
      target.items.push(bm.id);
    }
  });
  if (!editingId) toast('Bookmark added');
  finishBookmarkletSave();
});

$('[data-delete]', bmDialog).addEventListener('click', () => {
  const id = bmEditing;
  bmDialog.close('delete');
  if (id) deleteWithUndo(id);
});

// --- group dialog -------------------------------------------------------------
const groupDialog = $('#group-dialog');
const groupForm = $('#group-form');
let groupEditing = null;

$('[data-swatches]', groupDialog).innerHTML = COLORS.map(
  (c) =>
    `<label class="swatch" style="--gc:var(--g-${c})" title="${COLOR_LABELS[c]}"><input type="radio" name="color" value="${c}" aria-label="${COLOR_LABELS[c]}"><span class="dot"></span></label>`,
).join('');

function openGroupDialog(gid) {
  const g = gid ? state.doc.groups.find((x) => x.id === gid) : null;
  groupEditing = g ? g.id : null;
  const f = groupForm.elements;
  $('#group-heading').textContent = g ? 'Edit group' : 'New group';
  $('[data-delete]', groupDialog).hidden = !g;
  const s = state.doc.settings;
  modeOptions(f.mode, `Default (${modeLabel(s.defaultMode)})`);
  reuseOptions(f.reuse, `Default (${reuseText(s.defaultReuse)})`);
  f.name.value = g ? g.name : '';
  f.mode.value = g && g.mode ? g.mode : '';
  f.reuse.value = g && g.reuse !== null ? String(g.reuse) : '';
  f.openAllIn.value = g ? g.openAllIn : 'here';
  const color = g ? g.color : nextColor(state.doc);
  $$('input[name="color"]', groupDialog).forEach((r) => (r.checked = r.value === color));
  showError(groupDialog, '');
  groupDialog.showModal();
  f.name.focus();
}

groupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = groupForm.elements;
  const name = f.name.value.trim();
  if (!name) {
    showError(groupDialog, 'Name the group.');
    f.name.focus();
    return;
  }
  const checked = $('input[name="color"]:checked', groupDialog);
  const fields = {
    name,
    color: checked ? checked.value : 'grey',
    mode: f.mode.value || null,
    reuse: f.reuse.value === '' ? null : f.reuse.value === 'true',
    openAllIn: f.openAllIn.value === 'window' ? 'window' : 'here',
  };
  const editingId = groupEditing;
  groupDialog.close('save');
  let createdId = null;
  await commit((doc) => {
    if (editingId) {
      const g = doc.groups.find((x) => x.id === editingId);
      if (g) Object.assign(g, fields);
    } else {
      const g = Object.assign(newGroup(name), fields);
      createdId = g.id;
      doc.groups.push(g);
    }
  });
  if (createdId && layout() === 'sidebar') selectSidebarGroup(createdId);
});

$('[data-delete]', groupDialog).addEventListener('click', () => {
  const gid = groupEditing;
  groupDialog.close('delete');
  if (gid) deleteGroupWithUndo(gid);
});

// --- confirm dialog -----------------------------------------------------------
function confirmDialog(text, okLabel = 'OK') {
  const d = $('#confirm-dialog');
  $('[data-confirm-text]', d).textContent = text;
  $('[data-confirm-ok]', d).textContent = okLabel;
  d.returnValue = '';
  d.showModal();
  $('[data-confirm-ok]', d).focus();
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
  });
}

// --- settings -----------------------------------------------------------------
const settingsDialog = $('#settings-dialog');

async function fillShortcuts() {
  const lists = $$('[data-shortcuts]');
  if (!IS_EXTENSION || !ext.commands) {
    lists.forEach((l) => (l.innerHTML = ''));
    return;
  }
  const cmds = await ext.commands.getAll();
  const names = { _execute_action: 'Save the current page', 'open-app': 'Open Shelfmark' };
  const html = cmds
    .map((c) => `<li><span>${escHtml(names[c.name] || c.description || c.name)}</span><span>${c.shortcut ? escHtml(c.shortcut) : 'Not set'}</span></li>`)
    .join('');
  lists.forEach((l) => (l.innerHTML = html));
}

async function openSettings() {
  const s = state.doc.settings;
  const f = settingsDialog.querySelector('form').elements;
  f.defaultMode.innerHTML = MODE_ORDER.map((m) => `<option value="${m}">${escHtml(MODES[m].label)}</option>`).join('');
  f.defaultMode.value = s.defaultMode;
  f.defaultReuse.value = String(s.defaultReuse);
  f.openOnStartup.checked = s.openOnStartup;
  $$('input[name="theme"]', settingsDialog).forEach((r) => (r.checked = r.value === s.theme));
  $('[data-layout-current]', settingsDialog).textContent = `${LAYOUTS[s.layout].name}, ${s.density} row spacing.`;

  $$('input[name="siteIcons"]', settingsDialog).forEach((r) => (r.checked = r.value === s.siteIcons));
  fillWebAddresses(settingsDialog);
  renderWidgetList();

  const status = $('[data-incognito-status]', settingsDialog);
  if (!IS_EXTENSION) {
    status.textContent = 'Available once Shelfmark is installed as an extension.';
  } else {
    state.incognitoOK = await incognitoAllowed();
    status.innerHTML = state.incognitoOK
      ? '<span class="status-ok">Turned on. Private-window bookmarks open directly.</span>'
      : `<span class="status-off">Turned off.</span> ${escHtml(B.settingsHow)} so private-window bookmarks can open.`;
  }
  await fillShortcuts();
  settingsDialog.showModal();
}

settingsDialog.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'defaultMode') commit((doc) => (doc.settings.defaultMode = t.value));
  if (t.name === 'defaultReuse') commit((doc) => (doc.settings.defaultReuse = t.value === 'true'));
  if (t.name === 'theme') commit((doc) => (doc.settings.theme = t.value));
  if (t.name === 'openOnStartup') commit((doc) => (doc.settings.openOnStartup = t.checked));
  if (t.name === 'siteIcons') commit((doc) => (doc.settings.siteIcons = t.value));
  if (t.dataset.widgetToggle) {
    commit((doc) => {
      const w = doc.settings.widgets.find((x) => x.id === t.dataset.widgetToggle);
      if (w) w.on = t.checked;
    });
  }
});

// The calculator works in the search box, so it's listed first and has no place in the order.
function renderWidgetList() {
  const list = $('[data-widget-list]', settingsDialog);
  const ws = state.doc.settings.widgets;
  const inPanel = ws.filter((w) => !WIDGETS[w.id].inSearch);
  const item = (w, i) => {
    const def = WIDGETS[w.id];
    const name = escHtml(def.name);
    const move = def.inSearch
      ? ''
      : `<span class="wl-move">
          <button type="button" class="icon-btn" data-widget-move="${w.id}" data-dir="-1" aria-label="Move ${name} up" title="Move up" ${i === 0 ? 'disabled' : ''}>${ICONS.up}</button>
          <button type="button" class="icon-btn" data-widget-move="${w.id}" data-dir="1" aria-label="Move ${name} down" title="Move down" ${i === inPanel.length - 1 ? 'disabled' : ''}>${ICONS.down}</button>
        </span>`;
    return `<li class="wl-item" data-wid="${w.id}">
      <label class="wl-main"><input type="checkbox" data-widget-toggle="${w.id}" ${w.on ? 'checked' : ''} />
        <span><strong>${name}</strong>${def.inSearch ? '<span class="wl-tag">In the search box</span>' : ''}<span class="hint">${escHtml(def.blurb)}</span></span>
      </label>${move}
    </li>`;
  };
  list.innerHTML = ws.filter((w) => WIDGETS[w.id].inSearch).map((w) => item(w, -1)).join('') + inPanel.map(item).join('');
}

settingsDialog.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-widget-move]');
  if (!b || b.disabled) return;
  const id = b.dataset.widgetMove;
  const dir = Number(b.dataset.dir);
  await commit((doc) => {
    const ws = doc.settings.widgets;
    const slots = ws.map((w, i) => (WIDGETS[w.id].inSearch ? -1 : i)).filter((i) => i >= 0);
    const pos = slots.findIndex((i) => ws[i].id === id);
    const other = slots[pos + dir];
    if (pos < 0 || other === undefined) return;
    [ws[slots[pos]], ws[other]] = [ws[other], ws[slots[pos]]];
  });
  renderWidgetList();
  const same = $(`[data-widget-move="${id}"][data-dir="${dir}"]`, settingsDialog);
  const flip = $(`[data-widget-move="${id}"][data-dir="${-dir}"]`, settingsDialog);
  (same && !same.disabled ? same : flip).focus();
});

// --- website: addresses for home page, site search and the save button -------------
function bookmarkletCode() {
  const target = siteBase() + '?add=';
  return (
    'javascript:(()=>{window.open(' +
    JSON.stringify(target) +
    "+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank')})()"
  );
}

function fillWebAddresses(root) {
  if (!IS_WEB) return;
  $$('[data-home-url]', root).forEach((i) => (i.value = siteBase()));
  $$('[data-search-url]', root).forEach((i) => (i.value = siteBase() + '?q=%s&go=1'));
  $$('[data-bookmarklet]', root).forEach((a) => a.setAttribute('href', bookmarkletCode()));
}

document.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const input = copyBtn.parentElement.querySelector('input');
    const ok = await copyText(input.value);
    if (!ok) input.select();
    copyBtn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1800);
  }
  // The save button only works from the bookmarks bar; clicking it here does nothing useful.
  if (e.target.closest('[data-bookmarklet]')) {
    e.preventDefault();
    toast('Drag this button to your bookmarks bar, then click it on any page to save that page.');
  }
});

function openHelp() {
  fillShortcuts();
  $('[data-calc-help]').hidden = !widgetOn(state.doc.settings, 'calc');
  $('#help-dialog').showModal();
}

// --- import / export ----------------------------------------------------------
async function exportBackup() {
  if (MODE === 'preview') {
    toast('In the extension, this downloads a backup file with every group, bookmark and setting.');
    return;
  }
  const doc = await loadDoc();
  const stats = await loadStats();
  downloadJson(exportPayload(doc, stats, await loadWidgetData()), backupFilename());
  toast('Backup downloaded');
}

const importDialog = $('#import-dialog');
const importForm = $('#import-form');
let parsedImport = null;

function openImportDialog() {
  parsedImport = null;
  importForm.reset();
  $('[data-file-label]', importDialog).textContent = 'Choose file…';
  $('[data-summary]', importDialog).hidden = true;
  $('[data-backup-opts]', importDialog).hidden = true;
  $('[data-dupe-opt]', importDialog).hidden = true;
  $('[data-import-go]', importDialog).disabled = true;
  showError(importDialog, '');
  importDialog.showModal();
}

importForm.elements.file.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  parsedImport = null;
  $('[data-import-go]', importDialog).disabled = true;
  $('[data-summary]', importDialog).hidden = true;
  $('[data-backup-opts]', importDialog).hidden = true;
  $('[data-dupe-opt]', importDialog).hidden = true;
  showError(importDialog, '');
  if (!file) return;
  $('[data-file-label]', importDialog).textContent = file.name;
  try {
    const text = await file.text();
    parsedImport = parseImportText(text, file.name);
    const s = summarize(parsedImport);
    const summary = $('[data-summary]', importDialog);
    summary.textContent = `Found ${s.bookmarks} bookmark${s.bookmarks === 1 ? '' : 's'} in ${s.groups} group${s.groups === 1 ? '' : 's'}.`;
    summary.hidden = false;
    $('[data-backup-opts]', importDialog).hidden = parsedImport.kind !== 'backup';
    $('[data-dupe-opt]', importDialog).hidden = false;
    $('[data-import-go]', importDialog).disabled = false;
  } catch (err) {
    showError(importDialog, err.message);
  }
});

importForm.addEventListener('change', (e) => {
  if (e.target.name === 'how') $('[data-dupe-opt]', importDialog).hidden = e.target.value === 'replace';
});

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!parsedImport) return;
  const f = importForm.elements;
  const replace = parsedImport.kind === 'backup' && f.how.value === 'replace';
  const skipDuplicates = f.skipDupes.checked;
  const beforeDoc = await loadDoc();
  const beforeStats = await loadStats();
  const beforeWidgets = await loadWidgetData();
  const widgetsReplaced = replace && !!parsedImport.widgets;
  importDialog.close('import');

  const undo = async () => {
    await replaceDoc(beforeDoc);
    await replaceStats(beforeStats);
    if (widgetsReplaced) {
      await replaceWidgetData(beforeWidgets);
      await panel.refresh();
    }
    state.doc = await loadDoc();
    state.stats = await loadStats();
    render();
  };

  if (replace) {
    // Keep this browser's layout and setup state; a backup from elsewhere shouldn't change them.
    const incoming = clone(parsedImport.doc);
    incoming.settings.layout = beforeDoc.settings.layout;
    incoming.settings.density = beforeDoc.settings.density;
    incoming.settings.openOnStartup = beforeDoc.settings.openOnStartup;
    incoming.settings.setupDone = beforeDoc.settings.setupDone;
    await replaceDoc(incoming);
    await replaceStats(parsedImport.stats);
    if (widgetsReplaced) {
      await replaceWidgetData(parsedImport.widgets);
      await panel.refresh();
    }
    state.doc = await loadDoc();
    state.stats = await loadStats();
    render();
    toast('Replaced everything with the backup', { action: 'Undo', onAction: undo, timeout: 10000 });
  } else {
    const result = await commit((doc) => mergeInto(doc, parsedImport, { skipDuplicates }));
    const parts = [`Imported ${result.bookmarksAdded} bookmark${result.bookmarksAdded === 1 ? '' : 's'}`];
    if (result.skipped) parts.push(`skipped ${result.skipped} already saved`);
    toast(parts.join(', '), { action: 'Undo', onAction: undo, timeout: 10000 });
  }
  document.dispatchEvent(new CustomEvent('shelfmark:imported'));
});

// --- setup ------------------------------------------------------------------------
const setup = createSetup({
  getDoc: () => state.doc,
  commit,
  openImportDialog,
  onDone: () => searchInput.focus(),
});

// --- live updates from other tabs, the popup and the right-click menu ---------
onStoreChange(async (what) => {
  if (what.widgets) panel.refresh();
  if (what.doc) state.doc = await loadDoc();
  if (what.stats) state.stats = await loadStats();
  if (what.doc || layout() === 'table' || layout() === 'launcher' || layout() === 'list') render();
});

window.addEventListener('focus', async () => {
  if (!IS_EXTENSION) return;
  const ok = await incognitoAllowed();
  if (ok !== state.incognitoOK) {
    state.incognitoOK = ok;
    renderNotice();
  }
});

// --- preview mode (the demo page with sample data) --------------------------------
if (MODE === 'preview') {
  const note = $('#preview-note');
  note.hidden = false;
  $$('[data-open-ext], [data-open-shortcuts]').forEach((b) => (b.hidden = true));
  note.textContent = 'Preview with sample bookmarks. Links don’t open here; clicking one shows what the extension would do. Weather, outages and traffic show sample data. Changes last until you reload.';
  globalThis.__SHELFMARK_PREVIEW_OPEN__ = (info) => {
    if (info.kind === 'group') {
      const parts = [];
      const tabs = (n) => `${n} tab${n === 1 ? '' : 's'}`;
      if (info.normal) parts.push(`${tabs(info.normal)} in a tab group named “${info.group.name}”`);
      if (info.priv) parts.push(`${tabs(info.priv)} in a private window`);
      toast(`Would open ${parts.join(', plus ')}.`);
      return;
    }
    const where = {
      tab: 'in a new tab',
      background: 'in a background tab',
      current: 'in this tab',
      window: 'in a new window',
      private: 'in a private window',
      app: 'in an app window',
    }[info.mode];
    toast(`Would open ${displayHost(info.url)} ${where}${info.reuse ? ', or switch to it if it’s already open' : ''}.`);
  };
}

// --- browser-specific words in the static markup ---------------------------------
function applyBrowserText() {
  $$('[data-b]').forEach((el) => {
    const v = B[el.dataset.b];
    if (typeof v === 'string') el.textContent = v;
  });
  if (IS_EXTENSION) {
    $$('[data-open-ext]').forEach((b) => (b.hidden = !canOpenExtensionSettings));
    $$('[data-open-shortcuts]').forEach((b) => (b.hidden = !canOpenShortcutSettings));
  }
  // Parts of the page that only make sense as an extension or only as a website.
  // The preview demonstrates the extension.
  const shown = IS_WEB ? 'web' : 'extension';
  $$('[data-mode]').forEach((el) => (el.hidden = el.dataset.mode !== shown));
  fillWebAddresses(document);
}

// --- start ----------------------------------------------------------------------
async function init() {
  setIcons();
  applyBrowserText();
  $('.search-ic').innerHTML = ICONS.search;
  // Widget contents first: once state.doc is set, anything (even a resize) may render.
  await panel.load();
  state.doc = await loadDoc();
  state.stats = await loadStats();
  try {
    const v = await getKey(VIEW_KEY);
    if (v && typeof v === 'object') {
      state.view.sidebarGroup = typeof v.sidebarGroup === 'string' ? v.sidebarGroup : null;
      if (v.sort && (v.sort.key === 'arrange' || SORTS[v.sort.key])) state.view.sort = { key: v.sort.key, dir: v.sort.dir === -1 ? -1 : 1 };
    }
  } catch { /* defaults */ }
  if (IS_EXTENSION) state.incognitoOK = await incognitoAllowed();
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const editId = params.get('edit');
  const go = params.get('go') === '1';
  const addUrl = params.get('add');
  if (q || editId || go || addUrl) history.replaceState(null, '', location.pathname);
  render();
  if (q) setQuery(q);

  // Address-bar search ("bm something" + Enter): go straight to the best match in this tab.
  if (go && q && state.bestId && state.doc.settings.setupDone) {
    const bm = state.doc.bookmarks[state.bestId];
    const eff = effectiveMode(bm);
    if (eff !== 'private') {
      await recordOpen(bm.id);
      location.replace(bm.url);
      return;
    }
    const copied = await copyText(bm.url);
    toast(`“${bm.title || displayHost(bm.url)}” opens in a private window, which a website can’t open.${copied ? ' Its link is copied.' : ''} Use ${B.privateKeys}.`, { timeout: 10000 });
  }

  if (state.doc.settings.setupDone) searchInput.focus();
  if (editId && state.doc.bookmarks[editId]) openBookmarkDialog(editId);

  // Save button on another site sent us here with ?add=<address>&title=<title>.
  if (addUrl && state.doc.settings.setupDone) {
    savingFromBookmarklet = true;
    openBookmarkDialog(null, { url: addUrl, title: params.get('title') || '' });
  }
}

function effectiveMode(bm) {
  const g = groupOf(state.doc, bm.id);
  return bm.mode || (g && g.mode) || state.doc.settings.defaultMode;
}

// After saving from the save button, close the tab it opened (allowed, because a script opened it).
let savingFromBookmarklet = false;
function finishBookmarkletSave() {
  if (!savingFromBookmarklet) return;
  savingFromBookmarklet = false;
  window.close();
  setTimeout(() => toast('Saved. You can close this tab.'), 300);
}

init();

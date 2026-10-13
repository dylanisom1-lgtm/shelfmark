// Storage, in one of three places:
//   extension  the extension's own storage (chrome.storage.local / browser.storage.local)
//   web        the browser's storage for the website (localStorage), shared between tabs
//   preview    memory only, seeded with sample data
// Everything goes through mutate(), which reads the freshest copy before changing it so
// other tabs, the popup and the background don't clobber each other.

import { normalizeDoc, emptyDoc } from './model.js';
import { ext, MODE } from './browser.js';

export const DOC_KEY = 'shelfmark.doc';
export const STATS_KEY = 'shelfmark.stats';
export const WIDGETS_KEY = 'shelfmark.widgets';
// Neither of these goes into backups: an API key shouldn't travel in a file, and fetched
// weather, status and traffic go stale anyway.
export const SECRETS_KEY = 'shelfmark.secrets';
export const CACHE_KEY = 'shelfmark.cache';

const chromeStore = MODE === 'extension' && ext.storage && ext.storage.local ? ext.storage.local : null;
export const IS_EXTENSION = !!chromeStore;
export const IS_WEB = MODE === 'web';

// Every github.io project page under one account shares a single storage area, so all
// of Shelfmark's keys start with "shelfmark." to stay out of other projects' way.
const local = (() => {
  if (!IS_WEB) return null;
  try {
    const t = '__shelfmark_test__';
    globalThis.localStorage.setItem(t, '1');
    globalThis.localStorage.removeItem(t);
    return globalThis.localStorage;
  } catch {
    return null; // storage blocked (some private modes); fall back to memory
  }
})();
export const STORAGE_AVAILABLE = IS_EXTENSION || !!local || MODE === 'preview';

// --- memory backend (preview, or web when storage is blocked) -----------------
const mem = {};
const localListeners = new Set();
if (MODE === 'preview' && globalThis.__SHELFMARK_SEED__) {
  mem[DOC_KEY] = JSON.parse(JSON.stringify(globalThis.__SHELFMARK_SEED__.doc));
  mem[STATS_KEY] = JSON.parse(JSON.stringify(globalThis.__SHELFMARK_SEED__.stats || {}));
  mem[WIDGETS_KEY] = JSON.parse(JSON.stringify(globalThis.__SHELFMARK_SEED__.widgets || {}));
  mem[CACHE_KEY] = JSON.parse(JSON.stringify(globalThis.__SHELFMARK_SEED__.cache || {}));
}

function notifyLocal(changes) {
  queueMicrotask(() => localListeners.forEach((fn) => fn(changes)));
}

async function rawGet(key) {
  if (chromeStore) {
    const r = await chromeStore.get(key);
    return r[key];
  }
  if (local) {
    const v = local.getItem(key);
    if (v === null) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return mem[key] === undefined ? undefined : JSON.parse(JSON.stringify(mem[key]));
}

let persistAsked = false;
async function rawSet(key, value) {
  if (chromeStore) return chromeStore.set({ [key]: value });
  if (local) {
    try {
      local.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new Error('This browser’s storage for the site is full. Export a backup, then remove some bookmarks.');
    }
    // Ask the browser not to clear Shelfmark's data when space runs low.
    if (!persistAsked && globalThis.navigator && navigator.storage && navigator.storage.persist) {
      persistAsked = true;
      navigator.storage.persist().catch(() => {});
    }
    notifyLocal({ [key]: true }); // other tabs hear about it through the "storage" event
    return;
  }
  mem[key] = JSON.parse(JSON.stringify(value));
  notifyLocal({ [key]: true });
}

// Small values that aren't part of the bookmark document (setup progress, view state).
export const getKey = rawGet;
export const setKey = rawSet;

// --- document ---------------------------------------------------------------
export async function loadDoc() {
  const raw = await rawGet(DOC_KEY);
  return raw ? normalizeDoc(raw) : emptyDoc();
}

export async function saveDoc(doc) {
  await rawSet(DOC_KEY, doc);
}

// Serializes writes from this context; fn edits the doc in place and may return a value.
let chain = Promise.resolve();
export function mutate(fn) {
  const run = chain.then(async () => {
    const doc = await loadDoc();
    const result = await fn(doc);
    await saveDoc(doc);
    return { doc, result };
  });
  chain = run.catch(() => {});
  return run;
}

export async function replaceDoc(doc) {
  await saveDoc(normalizeDoc(doc));
}

// --- usage stats (kept apart so opening a link never rewrites the whole doc) ---
export async function loadStats() {
  return (await rawGet(STATS_KEY)) || {};
}

let statsChain = Promise.resolve();
export function recordOpen(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  statsChain = statsChain
    .then(async () => {
      const stats = await loadStats();
      const now = Date.now();
      for (const id of list) {
        const s = stats[id] || { n: 0, last: 0 };
        stats[id] = { n: s.n + 1, last: now };
      }
      await rawSet(STATS_KEY, stats);
    })
    .catch(() => {});
  return statsChain;
}

export async function replaceStats(stats) {
  await rawSet(STATS_KEY, stats && typeof stats === 'object' ? stats : {});
}

// --- what the widgets hold (clock list, scratchpad text, last inputs) -------------
// Kept apart from the bookmarks, so typing in the scratchpad never rewrites them.
export async function loadWidgetData() {
  const v = await rawGet(WIDGETS_KEY);
  return v && typeof v === 'object' ? v : {};
}

let widgetChain = Promise.resolve();
// Replaces one widget's entry with `value`, reading the freshest copy first.
export function saveWidget(id, value) {
  widgetChain = widgetChain
    .then(async () => {
      const all = await loadWidgetData();
      all[id] = value;
      await rawSet(WIDGETS_KEY, all);
    })
    .catch(() => {});
  return widgetChain;
}

export async function replaceWidgetData(data) {
  await rawSet(WIDGETS_KEY, data && typeof data === 'object' ? data : {});
}

// One entry per widget, like the widget data, but never exported.
function keyedStore(key) {
  let chain = Promise.resolve();
  return {
    async load() {
      const v = await rawGet(key);
      return v && typeof v === 'object' ? v : {};
    },
    save(id, value) {
      chain = chain
        .then(async () => {
          const v = await rawGet(key);
          const all = v && typeof v === 'object' ? v : {};
          if (value === undefined) delete all[id];
          else all[id] = value;
          await rawSet(key, all);
        })
        .catch(() => {});
      return chain;
    },
  };
}
export const secrets = keyedStore(SECRETS_KEY);
export const cache = keyedStore(CACHE_KEY);

// --- change notifications ----------------------------------------------------
export function onStoreChange(cb) {
  const handler = (changes) => {
    const widgets = !!(changes[WIDGETS_KEY] || changes[SECRETS_KEY] || changes[CACHE_KEY]);
    if (changes[DOC_KEY] || changes[STATS_KEY] || widgets) {
      cb({ doc: !!changes[DOC_KEY], stats: !!changes[STATS_KEY], widgets });
    }
  };
  if (chromeStore) {
    const h = (changes, area) => area === 'local' && handler(changes);
    ext.storage.onChanged.addListener(h);
    return () => ext.storage.onChanged.removeListener(h);
  }
  localListeners.add(handler);
  let onStorage = null;
  if (local) {
    // Changes made in other tabs of the website
    onStorage = (e) => {
      if (e.storageArea === local && e.key) handler({ [e.key]: true });
    };
    globalThis.addEventListener('storage', onStorage);
  }
  return () => {
    localListeners.delete(handler);
    if (onStorage) globalThis.removeEventListener('storage', onStorage);
  };
}

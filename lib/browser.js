// The one place that knows where Shelfmark is running and in which browser.
// Firefox provides the promise-based `browser` namespace; Chrome and Edge provide `chrome`.
// Everything else in Shelfmark calls `ext` and reads browser-specific words from `B`.
//
// MODE is one of:
//   'extension'  installed as a browser extension: full abilities
//   'web'        opened as a website (GitHub Pages): saved in the browser's site storage,
//                links opened the ways a web page is allowed to
//   'preview'    the self-contained demo page with sample data that isn't saved

const g = globalThis;
const hasRuntime = (ns) => !!(ns && ns.runtime && ns.runtime.id);

export const ext = hasRuntime(g.browser) ? g.browser : hasRuntime(g.chrome) ? g.chrome : null;
export const MODE = ext ? 'extension' : g.__SHELFMARK_SEED__ ? 'preview' : 'web';

const isFirefox = !!ext && ext.runtime.getURL('').startsWith('moz-extension:');
const ua = (g.navigator && g.navigator.userAgent) || '';
const isMac = /Mac OS X|Macintosh/.test(ua);
const keys = (combo) => (isMac ? combo.replace('Ctrl+', '⌘').replace('Shift+', '⇧') : combo);
// Outside the extension (the web preview) there's no runtime to ask, so fall back to the user agent.
export const BROWSER = isFirefox || (!ext && /\bFirefox\//.test(ua)) ? 'firefox' : /\bEdg\//.test(ua) ? 'edge' : 'chrome';

const INFO = {
  chrome: {
    name: 'Chrome',
    privateSetting: 'Allow in Incognito',
    settingsHow: 'Turn on Allow in Incognito on Shelfmark’s details page',
    extensionsPage: (id) => `chrome://extensions/?id=${id}`,
    shortcutsPage: 'chrome://extensions/shortcuts',
    newTab: /^chrome:\/\/(newtab|new-tab-page)\/?$|^chrome-search:\/\/local-ntp/,
    exportSteps: 'open the Bookmark manager (Ctrl+Shift+O), click the ⋮ menu, and choose Export bookmarks',
    favicons: true,
    richOmnibox: true,
    privateKeys: keys('Ctrl+Shift+N'),
    homeSteps: 'Open Settings › On startup, choose Open a specific page or set of pages, click Add a new page, and paste the address',
    searchSteps: 'Open Settings › Search engine › Manage search engines and site search. Next to Site search, click Add. Name it Shelfmark, use bm as the shortcut, and paste the address as the URL',
  },
  edge: {
    name: 'Edge',
    privateSetting: 'Allow in InPrivate',
    settingsHow: 'Turn on Allow in InPrivate on Shelfmark’s details page',
    extensionsPage: (id) => `edge://extensions/?id=${id}`,
    shortcutsPage: 'edge://extensions/shortcuts',
    newTab: /^(edge|chrome):\/\/(newtab|new-tab-page)\/?$|^https:\/\/ntp\.msn\.com\/edge\/ntp/,
    exportSteps: 'open Favorites (Ctrl+Shift+O), click the ⋯ menu, and choose Export favorites',
    favicons: true,
    richOmnibox: true,
    privateKeys: keys('Ctrl+Shift+N'),
    homeSteps: 'Open Settings › Start, home, and new tabs. Under When Edge starts, choose Open these pages, click Add a new page, and paste the address',
    searchSteps: 'Open Settings › Privacy, search, and services › Address bar and search › Manage search engines, and click Add. Name it Shelfmark, use bm as the shortcut, and paste the address as the URL',
  },
  firefox: {
    name: 'Firefox',
    privateSetting: 'Run in Private Windows',
    // Firefox doesn't let extensions open about:addons, so this is spelled out instead.
    settingsHow: 'Open the ☰ menu › Add-ons and themes, click Shelfmark, and set Run in Private Windows to Allow',
    extensionsPage: null,
    shortcutsPage: null,
    newTab: /^about:(newtab|home)$/,
    exportSteps: 'open the Library (Ctrl+Shift+O), choose Import and Backup, then Export Bookmarks to HTML',
    favicons: false, // no favicon API in Firefox; rows use lettered tiles
    richOmnibox: false, // Firefox shows address-bar suggestions as plain text
    privateKeys: keys('Ctrl+Shift+P'),
    homeSteps: 'Open Settings › Home. Under Homepage and new windows, choose Custom URLs and paste the address',
    searchSteps: 'Bookmark the address (Ctrl+D), then open the bookmark’s Edit window and set its Keyword to bm',
  },
};

export const B = INFO[BROWSER];

// The website's address without a file name or query: https://you.github.io/shelfmark/
export function siteBase() {
  const l = g.location;
  return l ? l.origin + l.pathname.replace(/[^/]*$/, '') : '';
}

// For using an instruction mid-sentence.
export const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export const canOpenExtensionSettings = !!(ext && B.extensionsPage);
export const canOpenShortcutSettings = !!(ext && (B.shortcutsPage || (ext.commands && ext.commands.openShortcutSettings)));

export function openExtensionSettings() {
  if (!canOpenExtensionSettings) return false;
  ext.tabs.create({ url: B.extensionsPage(ext.runtime.id) });
  return true;
}

export function openShortcutSettings() {
  if (!ext) return false;
  if (B.shortcutsPage) {
    ext.tabs.create({ url: B.shortcutsPage });
    return true;
  }
  if (ext.commands && ext.commands.openShortcutSettings) {
    ext.commands.openShortcutSettings();
    return true;
  }
  return false;
}

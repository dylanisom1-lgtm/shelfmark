// Fetching live data for the weather, outage and traffic widgets.
// Failures come back as a NetError with a kind the widgets can explain:
//   offline   the computer has no connection
//   blocked   the request never got an answer: the service is down, or (on the website)
//             it doesn't let pages on other sites read it
//   http      the service answered with an error status
//   timeout   no answer in time
//   format    the answer wasn't what was expected
//   preview   the preview page doesn't make network requests

import { ext, MODE } from './browser.js';

export class NetError extends Error {
  constructor(kind, message, status = 0, body = null) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

export async function request(url, { timeout = 15000, ...init } = {}) {
  if (MODE === 'preview') throw new NetError('preview', 'The preview shows sample data.');
  if (globalThis.navigator && navigator.onLine === false) throw new NetError('offline', 'You’re offline.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', credentials: 'omit', ...init, signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted) throw new NetError('timeout', 'No answer in time.');
    throw new NetError('blocked', 'Couldn’t reach it.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch { /* not JSON */ }
    throw new NetError('http', `The service answered ${res.status}.`, res.status, body);
  }
  return res;
}

export async function getJson(url, opts) {
  const res = await request(url, opts);
  try {
    return await res.json();
  } catch {
    throw new NetError('format', 'The answer wasn’t readable.');
  }
}

export async function getText(url, opts) {
  const res = await request(url, opts);
  return res.text();
}

// --- extension: permission to read sites that don't allow other pages to read them ---------
// Status feeds from Microsoft, AWS, Google and others don't send the headers a page on
// another site needs. The extension can read them once it has permission for that site.
// Must be called straight from a click, before anything is awaited.
export const canAskForSites = !!(ext && ext.permissions && ext.permissions.request);

export function askForSite(url) {
  if (!canAskForSites) return Promise.resolve(false);
  try {
    const origin = new URL(url).origin + '/*';
    return Promise.resolve(ext.permissions.request({ origins: [origin] })).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export async function hasSite(url) {
  if (!canAskForSites || !ext.permissions.contains) return false;
  try {
    return !!(await ext.permissions.contains({ origins: [new URL(url).origin + '/*'] }));
  } catch {
    return false;
  }
}

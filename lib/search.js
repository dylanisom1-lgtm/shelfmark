// Fuzzy search shared by the app page and the address-bar keyword.
// Every word typed must match somewhere (title, site, tags, group, notes, path);
// exact substrings and word starts beat scattered letters.

import { displayHost, groupOf, effective, MODES } from './model.js';

const SEP = /[\s\-_/.:@#?&=+,()[\]|]/;

function isWordStart(text, i) {
  return i === 0 || SEP.test(text[i - 1]);
}

// Returns { score, pos } or null. `pos` holds matched character indices for highlighting.
export function matchTerm(term, text) {
  if (!term || !text) return null;
  const t = text.toLowerCase();
  const idx = t.indexOf(term);
  if (idx >= 0) {
    let score = 100 + term.length * 2;
    if (isWordStart(t, idx)) score += 40;
    if (idx === 0) score += 20;
    score -= Math.min(idx, 40) * 0.5;
    const pos = [];
    for (let i = 0; i < term.length; i++) pos.push(idx + i);
    return { score, pos };
  }
  if (term.length < 2) return null;

  // Short terms only match as initials ("ms" for "Microsoft Store"), never as scattered letters.
  if (term.length <= 3) {
    const pos = [];
    let from = 0;
    for (const ch of term) {
      let found = -1;
      for (let j = from; j < t.length; j++) {
        if (t[j] === ch && isWordStart(t, j)) { found = j; break; }
      }
      if (found < 0) return null;
      pos.push(found);
      from = found + 1;
    }
    return { score: 70 + term.length * 4, pos };
  }

  // Scattered letters, in order. Prefer matches that land on word starts.
  let score = 0;
  let ti = 0;
  let last = -2;
  const pos = [];
  for (let qi = 0; qi < term.length; qi++) {
    const ch = term[qi];
    // look ahead for a word-start occurrence before settling for the next occurrence
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] !== ch) continue;
      if (found < 0) found = j;
      if (isWordStart(t, j) && j - ti < 12) { found = j; break; }
      if (j === last + 1) { found = j; break; }
    }
    if (found < 0) return null;
    let pts = 1;
    if (found === last + 1) pts += 5;
    if (isWordStart(t, found)) pts += 8;
    pts -= Math.min(found - ti, 10) * 0.3;
    score += pts;
    pos.push(found);
    last = found;
    ti = found + 1;
  }
  const spread = pos[pos.length - 1] - pos[0];
  if (spread > term.length * 4 + 8) return null;
  return { score: Math.min(score, 60), pos };
}

const FIELDS = [
  ['title', 1.0],
  ['host', 0.85],
  ['tags', 0.75],
  ['group', 0.55],
  ['path', 0.4],
  ['behavior', 0.35],
  ['notes', 0.3],
];

function fieldsFor(doc, bm) {
  let path = '';
  try {
    const u = new URL(bm.url);
    path = u.pathname + u.search;
  } catch { /* ignore */ }
  const g = groupOf(doc, bm.id);
  const eff = effective(doc, bm, g);
  const behavior = [MODES[eff.mode].label, eff.reuse ? 'switch to open tab' : ''].join(' ');
  return {
    behavior,
    title: bm.title || '',
    host: displayHost(bm.url),
    tags: bm.tags.join(' '),
    group: g ? g.name : '',
    path,
    notes: bm.notes || '',
  };
}

export function terms(query) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Returns matches sorted best-first: [{ id, score, titlePos, hostPos }]
export function searchDoc(doc, query, stats = {}) {
  const words = terms(query);
  if (!words.length) return [];
  const out = [];
  for (const bm of Object.values(doc.bookmarks)) {
    const f = fieldsFor(doc, bm);
    let total = 0;
    const titlePos = new Set();
    const hostPos = new Set();
    let ok = true;
    for (const w of words) {
      let best = null;
      for (const [name, weight] of FIELDS) {
        const m = matchTerm(w, f[name]);
        if (!m) continue;
        const s = m.score * weight;
        if (!best || s > best.s) best = { s, name, pos: m.pos };
        // keep highlights for every visible field that matched
        if (name === 'title') m.pos.forEach((p) => titlePos.add(p));
        if (name === 'host') m.pos.forEach((p) => hostPos.add(p));
      }
      if (!best) { ok = false; break; }
      total += best.s;
    }
    if (!ok) continue;
    const st = stats[bm.id];
    if (st) total += Math.log2(st.n + 1) * 3;
    out.push({ id: bm.id, score: total, titlePos, hostPos });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

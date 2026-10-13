// Markup shared by every layout: rows, group sections, favicons, behavior glyphs.

import { MODES, effective, groupDefaults, displayHost, fallbackTitle } from '../lib/model.js';
import { IS_EXTENSION } from '../lib/store.js';
import { ICONS } from '../lib/icons.js';
import { ext, B, MODE } from '../lib/browser.js';

let webIcons = 'letters';
export function setIconSource(v) {
  webIcons = v;
}

export const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function highlight(text, positions) {
  if (!positions || !positions.size) return escHtml(text);
  let out = '';
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const hit = positions.has(i);
    if (hit && !open) { out += '<mark>'; open = true; }
    if (!hit && open) { out += '</mark>'; open = false; }
    out += escHtml(text[i]);
  }
  if (open) out += '</mark>';
  return out;
}

export function hue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export function favicon(bm, size = 32) {
  const host = displayHost(bm.url);
  const letter = escHtml((host || bm.title || '?').replace(/^[^a-z0-9]+/i, '').charAt(0).toUpperCase() || '?');
  const h = hue(host || bm.url);
  const mono = `<span class="fav mono" style="--h:${h}" aria-hidden="true">${letter}</span>`;
  if (MODE === 'web' && webIcons === 'site' && /^https:/.test(bm.url) && host) {
    let origin = '';
    try {
      origin = new URL(bm.url).origin;
    } catch { /* ignore */ }
    if (origin) return `<img class="fav" src="${escHtml(origin + '/favicon.ico')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" data-mono="${letter}" data-h="${h}">`;
  }
  if (!IS_EXTENSION || !B.favicons) return mono;
  const src = ext.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(bm.url) + '&size=' + size;
  return `<img class="fav" src="${escHtml(src)}" alt="" loading="lazy" decoding="async" draggable="false" data-mono="${letter}" data-h="${h}">`;
}

export function modeLabel(mode) {
  return MODES[mode] ? MODES[mode].label : mode;
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
export function relTime(ts) {
  if (!ts) return 'Never';
  const s = (ts - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) {
    if (Math.abs(s) >= sec) {
      const t = rtf ? rtf.format(Math.round(s / sec), u) : `${Math.round(Math.abs(s) / sec)} ${u}s ago`;
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return 'Just now';
}

// The mode glyph shows when a link opens some way other than the default;
// faded means the group set it. A circular arrow means "switch to it if open".
export function glyphs(doc, eff, { isGroup = false } = {}) {
  const def = doc.settings.defaultMode;
  let html = '';
  const showMode = eff.mode !== def || (!isGroup && eff.modeSource === 'bookmark') || (isGroup && eff.modeSource === 'group');
  if (showMode) {
    const inherited = !isGroup && eff.modeSource !== 'bookmark';
    const tip = modeLabel(eff.mode) + (inherited ? ' (set by group)' : '');
    html += `<span class="glyph mode-${eff.mode}${inherited ? ' inherited' : ''}" title="${escHtml(tip)}" role="img" aria-label="${escHtml(tip)}">${ICONS[eff.mode]}</span>`;
  }
  if (eff.reuse) {
    const inherited = !isGroup && eff.reuseSource !== 'bookmark';
    const tip = 'Switches to the tab if it’s already open' + (inherited ? ' (set by group)' : '');
    html += `<span class="glyph reuse${inherited ? ' inherited' : ''}" title="${escHtml(tip)}" role="img" aria-label="${escHtml(tip)}">${ICONS.reuse}</span>`;
  }
  return html;
}

export function groupStyle(g) {
  return `--gc:var(--g-${g.color});--gc-ink:var(--g-${g.color}-ink)`;
}

// ctx: { doc, stats, matches, bestId, editing }
// opts.showGroup adds the group as a chip (flat result lists); opts.iconSize sets favicon resolution.
export function rowHtml(ctx, bm, group, match, opts = {}) {
  const eff = effective(ctx.doc, bm, group);
  const title = bm.title || fallbackTitle(bm.url);
  const host = displayHost(bm.url);
  const best = match && ctx.bestId === bm.id;
  const st = ctx.stats[bm.id];
  const tipParts = [bm.url];
  if (bm.notes) tipParts.push(bm.notes);
  if (bm.tags.length) tipParts.push('Tags: ' + bm.tags.join(', '));
  const enter = best ? `<span class="glyph enter" title="Press Enter to open">${ICONS.enter}</span>` : '';
  const tags = bm.tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join('');
  const last = st ? `<span class="last" title="Opened ${st.n} time${st.n === 1 ? '' : 's'} from Shelfmark">${escHtml(relTime(st.last))}</span>` : '';
  const chip = opts.showGroup && group ? `<span class="gchip" style="${groupStyle(group)}">${escHtml(group.name)}</span>` : '';
  return `<li class="row${best ? ' best' : ''}" data-id="${bm.id}">
    <span class="grip" aria-hidden="true">${ICONS.grip}</span>
    <a class="link" href="${escHtml(bm.url)}" data-id="${bm.id}" draggable="false" title="${escHtml(tipParts.join('\n'))}">
      ${favicon(bm, opts.iconSize || 32)}
      <span class="title">${highlight(title, match && match.titlePos)}</span>
      <span class="host">${highlight(host, match && match.hostPos)}</span>
      <span class="meta">${tags}${last}</span>
      ${chip}
      <span class="glyphs">${glyphs(ctx.doc, eff)}${enter}</span>
    </a>
    <button type="button" class="icon-btn row-edit" data-act="edit" tabindex="-1" aria-label="Edit ${escHtml(title)}" title="Edit">${ICONS.edit}</button>
  </li>`;
}

export function groupHtml(ctx, g, opts = {}) {
  const { matches } = ctx;
  const searching = !!matches;
  const ids = searching ? g.items.filter((id) => matches.has(id)) : g.items;
  if (searching && !ids.length) return '';
  const collapsed = g.collapsed && !searching && !opts.noCollapse;
  const gd = groupDefaults(ctx.doc, g);
  const count = searching ? `${ids.length} of ${g.items.length}` : String(g.items.length);
  const rows = collapsed ? '' : ids.map((id) => rowHtml(ctx, ctx.doc.bookmarks[id], g, searching ? matches.get(id) : null, opts)).join('');
  const openTip = `Open all ${g.items.length} as a tab group`;
  const empty = !rows && !collapsed && !searching ? `<p class="group-empty">No bookmarks in this group yet.</p>` : '';
  return `<section class="group${collapsed ? ' collapsed' : ''}" data-gid="${g.id}" style="${groupStyle(g)}" aria-label="${escHtml(g.name)}">
    <header class="ghead">
      <span class="grip" aria-hidden="true">${ICONS.grip}</span>
      <button type="button" class="pill" data-act="collapse" aria-expanded="${!collapsed}" title="${collapsed ? 'Expand' : 'Collapse'}">${ICONS.chevron}<span class="label">${escHtml(g.name)}</span></button>
      <span class="count">${count}</span>
      <span class="glyphs">${glyphs(ctx.doc, gd, { isGroup: true })}</span>
      <span class="gactions">
        <button type="button" class="icon-btn" data-act="open-group" aria-label="${escHtml(openTip)}" title="${escHtml(openTip)}" ${g.items.length ? '' : 'disabled'}>${ICONS.openAll}</button>
        <button type="button" class="icon-btn" data-act="edit-group" aria-label="Edit group ${escHtml(g.name)}" title="Edit group">${ICONS.edit}</button>
      </span>
    </header>
    <ul class="items" role="list">${rows}</ul>${empty}
    ${ctx.editing && !searching ? `<button type="button" class="add-row" data-act="add-here">${ICONS.plus}Add bookmark</button>` : ''}
  </section>`;
}

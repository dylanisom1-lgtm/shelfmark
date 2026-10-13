// The six layouts. Each takes the same context and returns markup for #grid,
// so search, open behaviors, dialogs and shortcuts work the same everywhere.

import { MODES, effective, groupOf, displayHost, fallbackTitle } from '../lib/model.js';
import { escHtml, highlight, favicon, glyphs, relTime, modeLabel, rowHtml, groupHtml, groupStyle } from './ui.js';
import { ICONS } from '../lib/icons.js';

export const LAYOUTS = {
  columns: { name: 'Columns', blurb: 'Every group at a glance, in evenly filled columns.' },
  list: { name: 'List', blurb: 'One outline, with tags and when you last opened each link.' },
  tiles: { name: 'Tiles', blurb: 'Large icons, like a speed dial. Best for links you use daily.' },
  sidebar: { name: 'Sidebar', blurb: 'Groups down the left, one group at a time on the right.' },
  table: { name: 'Table', blurb: 'Sortable columns and changes to many bookmarks at once.' },
  launcher: { name: 'Launcher', blurb: 'A search box and your most-used links, nothing else.' },
};
export const LAYOUT_ORDER = ['columns', 'list', 'tiles', 'sidebar', 'table', 'launcher'];

// Small wireframes for the layout picker.
const bar = (w = 100, cls = '') => `<i class="lt-b ${cls}" style="width:${w}%"></i>`;
const pill = (c, w = 42) => `<i class="lt-p" style="width:${w}%;background:var(--g-${c})"></i>`;
export function layoutThumb(id) {
  switch (id) {
    case 'columns':
      return `<div class="lt lt-row">
        <div class="lt-col"><div class="lt-panel">${pill('red')}${bar()}${bar(80)}${bar(90)}</div><div class="lt-panel">${pill('purple', 36)}${bar(70)}</div></div>
        <div class="lt-col"><div class="lt-panel">${pill('blue')}${bar(85)}${bar()}</div><div class="lt-panel">${pill('cyan', 38)}${bar(90)}${bar(70)}</div></div>
        <div class="lt-col"><div class="lt-panel">${pill('green')}${bar(80)}${bar()}${bar(75)}${bar(90)}</div></div>
      </div>`;
    case 'list':
      return `<div class="lt">${pill('red', 28)}${bar(90)}${bar(75)}${bar(85)}${pill('blue', 22)}${bar(80)}${bar(65)}${pill('green', 30)}${bar(88)}</div>`;
    case 'tiles':
      return `<div class="lt">${pill('blue', 26)}<div class="lt-tiles">${'<i class="lt-t"></i>'.repeat(5)}</div>${pill('green', 30)}<div class="lt-tiles">${'<i class="lt-t"></i>'.repeat(3)}</div></div>`;
    case 'sidebar':
      return `<div class="lt lt-row"><div class="lt-nav">${pill('red', 90)}${bar(70, 'thick')}${bar(85, 'thick')}${bar(60, 'thick')}${bar(75, 'thick')}</div><div class="lt-col">${bar()}${bar(90)}${bar(80)}${bar()}${bar(70)}${bar(85)}</div></div>`;
    case 'table':
      return `<div class="lt"><div class="lt-grid head">${bar(100, 'dark')}${bar(100, 'dark')}${bar(100, 'dark')}${bar(100, 'dark')}</div>${'<div class="lt-grid">' + bar() + bar(80) + bar(60) + bar(40) + '</div>'}${('<div class="lt-grid">' + bar(90) + bar() + bar(70) + bar(55) + '</div>').repeat(4)}</div>`;
    case 'launcher':
      return `<div class="lt lt-center"><i class="lt-search"></i>${bar(70)}${bar(62)}${bar(66)}</div>`;
    default:
      return '';
  }
}

export function layoutPickerHtml(current, name = 'layout') {
  return LAYOUT_ORDER.map(
    (id) => `<label class="lp-card">
      <input type="radio" name="${name}" value="${id}" ${id === current ? 'checked' : ''}>
      ${layoutThumb(id)}
      <span class="lp-name">${LAYOUTS[id].name}</span>
      <span class="lp-blurb">${LAYOUTS[id].blurb}</span>
    </label>`,
  ).join('');
}

const newGroupTile = (ctx) => (ctx.editing && !ctx.q ? `<button type="button" class="new-group" data-act="new-group">${ICONS.plus}New group</button>` : '');

// --- Columns: masonry, each group goes into whichever column is currently shortest ---
function columns(ctx, env) {
  const n = env.cols;
  const cols = Array.from({ length: n }, () => ({ html: [], h: 0 }));
  const place = (html, h) => {
    const c = cols.reduce((a, b) => (b.h < a.h ? b : a));
    c.html.push(html);
    c.h += h + 16;
  };
  for (const g of ctx.doc.groups) {
    const html = groupHtml(ctx, g);
    if (!html) continue;
    const rows = ctx.matches ? g.items.filter((id) => ctx.matches.has(id)).length : g.items.length;
    const collapsed = g.collapsed && !ctx.matches;
    place(html, collapsed ? 46 : 48 + Math.max(rows, 1) * env.rowH + (ctx.editing ? 36 : 0));
  }
  const tile = newGroupTile(ctx);
  if (tile) place(tile, 56);
  return { html: cols.map((c) => `<div class="col">${c.html.join('')}</div>`).join(''), cols: n };
}

// --- List: one outline, rows show tags and last-opened ---
function list(ctx) {
  return { html: ctx.doc.groups.map((g) => groupHtml(ctx, g)).join('') + newGroupTile(ctx) };
}

// --- Tiles: groups stacked, bookmarks as icon tiles ---
function tiles(ctx) {
  return { html: ctx.doc.groups.map((g) => groupHtml(ctx, g, { iconSize: 64 })).join('') + newGroupTile(ctx) };
}

// --- Sidebar: group list on the left, one group on the right ---
function sidebar(ctx, env) {
  const { doc, matches } = ctx;
  const selected = doc.groups.find((g) => g.id === env.sidebarGroup) || doc.groups[0];
  const nav = doc.groups
    .map((g) => {
      const active = !matches && selected && g.id === selected.id;
      const n = matches ? g.items.filter((id) => matches.has(id)).length : g.items.length;
      const dim = matches && !n ? ' dim' : '';
      return `<li class="navitem${active ? ' active' : ''}${dim}" data-gid="${g.id}" style="${groupStyle(g)}">
        <span class="grip" aria-hidden="true">${ICONS.grip}</span>
        <button type="button" class="navbtn" data-act="select-group" ${active ? 'aria-current="true"' : ''}>
          <span class="dot" aria-hidden="true"></span><span class="name">${escHtml(g.name)}</span><span class="count">${n}</span>
        </button>
      </li>`;
    })
    .join('');
  const main = matches
    ? doc.groups.map((g) => groupHtml(ctx, g, { noCollapse: true })).join('')
    : selected
      ? groupHtml(ctx, selected, { noCollapse: true })
      : '';
  const addGroup = ctx.editing && !ctx.q ? `<button type="button" class="add-row" data-act="new-group">${ICONS.plus}New group</button>` : '';
  return {
    html: `<div class="sb"><nav class="sb-nav" aria-label="Groups"><ul class="nav-list" role="list">${nav}</ul>${addGroup}</nav><div class="sb-main">${main}</div></div>`,
    selectedId: selected ? selected.id : null,
  };
}

// --- Table: sortable, with checkboxes for bulk changes in edit mode ---
const SORTS = {
  name: { label: 'Name', get: (c, bm) => (bm.title || fallbackTitle(bm.url)).toLowerCase() },
  site: { label: 'Site', get: (c, bm) => displayHost(bm.url) },
  group: { label: 'Group', get: (c, bm) => c.groupIndex[bm.id] ?? 9999 },
  opens: { label: 'Opens in', get: (c, bm) => MODES[effective(c.doc, bm).mode].label },
  last: { label: 'Last opened', get: (c, bm) => (c.stats[bm.id] ? c.stats[bm.id].last : 0), firstDir: -1 },
  count: { label: 'Opened', get: (c, bm) => (c.stats[bm.id] ? c.stats[bm.id].n : 0), firstDir: -1 },
};
export { SORTS };

function table(ctx, env) {
  const { doc, matches, stats } = ctx;
  const groupIndex = {};
  const order = [];
  doc.groups.forEach((g, gi) => g.items.forEach((id) => { groupIndex[id] = gi; order.push(id); }));
  let ids = matches ? order.filter((id) => matches.has(id)) : order;
  const sort = env.sort || { key: 'arrange', dir: 1 };
  if (SORTS[sort.key]) {
    const c = { doc, stats, groupIndex };
    const get = SORTS[sort.key].get;
    const pos = Object.fromEntries(order.map((id, i) => [id, i]));
    ids = [...ids].sort((a, b) => {
      const va = get(c, doc.bookmarks[a]);
      const vb = get(c, doc.bookmarks[b]);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return pos[a] - pos[b];
    });
  }
  const sel = env.selected;
  const editing = ctx.editing;
  const head = Object.entries(SORTS)
    .map(([key, s]) => {
      const on = sort.key === key;
      const aria = on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';
      const arrow = on ? `<span class="sort-arrow${sort.dir === -1 ? ' down' : ''}" aria-hidden="true">${ICONS.chevron}</span>` : '';
      return `<th class="c-${key}" aria-sort="${aria}"><button type="button" class="sort" data-sort="${key}">${s.label}${arrow}</button></th>`;
    })
    .join('');
  const allChecked = ids.length && ids.every((id) => sel.has(id));
  const rows = ids
    .map((id) => {
      const bm = doc.bookmarks[id];
      const g = groupOf(doc, id);
      const eff = effective(doc, bm, g);
      const m = matches ? matches.get(id) : null;
      const title = bm.title || fallbackTitle(bm.url);
      const st = stats[id];
      const best = m && ctx.bestId === id;
      const fromGroup = eff.modeSource !== 'bookmark';
      const opensCell = `<span class="opens${fromGroup ? ' inherited' : ''}" title="${fromGroup ? 'Set by the group or default' : 'Set on this bookmark'}"><span class="glyph mode-${eff.mode}">${ICONS[eff.mode]}</span>${escHtml(modeLabel(eff.mode))}</span>`;
      return `<tr class="row trow${best ? ' best' : ''}${sel.has(id) ? ' selected' : ''}" data-id="${id}">
        ${editing ? `<td class="c-check"><input type="checkbox" data-act="select" ${sel.has(id) ? 'checked' : ''} aria-label="Select ${escHtml(title)}"></td>` : ''}
        <td class="c-name"><a class="link" href="${escHtml(bm.url)}" data-id="${id}" draggable="false" title="${escHtml(bm.url)}">${favicon(bm)}<span class="title">${highlight(title, m && m.titlePos)}</span>${best ? `<span class="glyph enter" title="Press Enter to open">${ICONS.enter}</span>` : ''}</a></td>
        <td class="c-site">${highlight(displayHost(bm.url), m && m.hostPos)}</td>
        <td class="c-group">${g ? `<span class="gchip" style="${groupStyle(g)}">${escHtml(g.name)}</span>` : ''}</td>
        <td class="c-opens"><div class="opens-wrap">${opensCell}${eff.reuse ? `<span class="glyph reuse" title="Switches to the tab if it’s already open">${ICONS.reuse}</span>` : ''}</div></td>
        <td class="c-last">${escHtml(relTime(st && st.last))}</td>
        <td class="c-count">${st ? st.n : ''}</td>
        <td class="c-edit"><button type="button" class="icon-btn row-edit" data-act="edit" tabindex="-1" aria-label="Edit ${escHtml(title)}" title="Edit">${ICONS.edit}</button></td>
      </tr>`;
    })
    .join('');

  let toolbar = '';
  if (editing) {
    const n = [...sel].filter((id) => doc.bookmarks[id]).length;
    toolbar = n
      ? `<div class="bulkbar" role="region" aria-label="Change selected bookmarks">
          <strong>${n} selected</strong>
          <label>Move to <select class="select" data-bulk="move"><option value="">Choose a group</option>${doc.groups.map((g) => `<option value="${g.id}">${escHtml(g.name)}</option>`).join('')}</select></label>
          <label>Opens in <select class="select" data-bulk="mode"><option value="">Choose</option><option value="__inherit">Group setting</option>${Object.entries(MODES).map(([k, v]) => `<option value="${k}">${escHtml(v.label)}</option>`).join('')}</select></label>
          <label>If already open <select class="select" data-bulk="reuse"><option value="">Choose</option><option value="__inherit">Group setting</option><option value="true">Switch to it</option><option value="false">Open another</option></select></label>
          <span class="spacer"></span>
          <button type="button" class="btn quiet danger" data-act="bulk-delete">Delete</button>
          <button type="button" class="btn quiet" data-act="bulk-clear">Clear selection</button>
        </div>`
      : `<div class="bulkbar hint-bar">Tick bookmarks to move them, change how they open, or delete them together.</div>`;
  } else if (sort.key !== 'arrange') {
    toolbar = `<div class="bulkbar hint-bar">Sorted by ${escHtml(SORTS[sort.key].label.toLowerCase())}. <button type="button" class="link-btn" data-act="sort-reset">Back to your order</button></div>`;
  }

  return {
    html: `${toolbar}<div class="table-wrap"><table class="bm-table">
      <thead><tr>${editing ? `<th class="c-check"><input type="checkbox" data-act="select-all" ${allChecked ? 'checked' : ''} aria-label="Select all shown"></th>` : ''}${head}<th class="c-edit"><span class="sr-only">Edit</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`,
  };
}

// --- Launcher: search box first; most-used links until you type ---
function launcher(ctx) {
  const { doc, stats } = ctx;
  const total = Object.keys(doc.bookmarks).length;
  if (ctx.q) {
    const rows = ctx.results
      .slice(0, 40)
      .map((r) => rowHtml(ctx, doc.bookmarks[r.id], groupOf(doc, r.id), r, { showGroup: true }))
      .join('');
    return { html: `<div class="launcher"><ul class="items flat" role="list">${rows}</ul></div>` };
  }
  const ids = Object.keys(doc.bookmarks);
  const used = ids.filter((id) => stats[id]).sort((a, b) => stats[b].n - stats[a].n || stats[b].last - stats[a].last);
  const rest = ids.filter((id) => !stats[id]).sort((a, b) => doc.bookmarks[b].added - doc.bookmarks[a].added);
  const top = [...used, ...rest].slice(0, 8);
  const label = used.length ? 'Most used' : 'Recently added';
  const rows = top.map((id) => rowHtml(ctx, doc.bookmarks[id], groupOf(doc, id), null, { showGroup: true })).join('');
  return {
    html: `<div class="launcher">
      <p class="launch-hint">Type to search ${total} bookmark${total === 1 ? '' : 's'}. <kbd>Enter</kbd> opens the top match.</p>
      <h2 class="launch-head">${label}</h2>
      <ul class="items flat" role="list">${rows}</ul>
    </div>`,
  };
}

export const VIEWS = { columns, list, tiles, sidebar, table, launcher };

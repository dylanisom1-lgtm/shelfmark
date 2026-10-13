// The widget panel. Settings › Widgets turns widgets on and sets their order. What they hold
// (the clock list, the scratchpad, saved places and routes, last inputs) is saved apart from
// the bookmarks and included in backups. The calculator isn't a panel: it answers in the
// search box (see app.js). Weather, outages and traffic fetch live data (see live.js).

import { parseSubnet } from '../lib/subnet.js';
import {
  parseTimestamp, describeInstant, relativeTime, READS, READ_ORDER,
  today, fromInput, toInput, formatDay, between, addToDate, UNITS, isoWeek, dayOfYear, dayNum,
} from '../lib/timetools.js';
import { loadWidgetData, saveWidget, secrets, cache } from '../lib/store.js';
import { ICONS } from '../lib/icons.js';
import { esc, num, plural, capFirst, debounce, copyBtn, kvList } from './wkit.js';
import { weather, outages, traffic } from './live.js';

export const WIDGETS = {
  calc: { name: 'Calculator', blurb: 'Type a sum like 1450*1.06 in the search box. Enter copies the answer.', inSearch: true },
  clocks: { name: 'Clocks', blurb: 'Your time, UTC, and any time zones you add.' },
  dates: { name: 'Date math', blurb: 'Days between two dates, or a date plus or minus days, weeks or months.' },
  scratch: { name: 'Scratchpad', blurb: 'A note that saves as you type.' },
  subnet: { name: 'Subnet calculator', blurb: 'Network, mask, range and host count for an IPv4 or IPv6 prefix.' },
  timestamp: { name: 'Timestamp converter', blurb: 'Unix, Active Directory and LDAP times to readable dates, and back.' },
  weather: { name: 'Weather', blurb: 'Conditions and forecasts for places you save. From Open-Meteo, which receives the places.', live: true },
  outages: { name: 'Outages', blurb: 'Status of online services you use, from their status pages. Problems show as a banner.', live: true },
  traffic: { name: 'Traffic', blurb: 'Live drive times for routes you save, from Google, using your own API key.', live: true },
};

// --- the panel -----------------------------------------------------------------------
export function createWidgetPanel({ root, toast, copyText, onAlerts = () => {} }) {
  let data = {};
  let keys = {}; // API keys: never exported
  let fetched = {}; // last results from live widgets: never exported
  let order = [];
  const live = new Map(); // id -> { section, inst }

  const announcer = document.createElement('p');
  announcer.className = 'sr-only';
  announcer.setAttribute('aria-live', 'polite');
  root.appendChild(announcer);

  const ctxFor = (id) => ({
    get: () => (data[id] && typeof data[id] === 'object' ? data[id] : {}),
    save: (value) => {
      data[id] = value;
      return saveWidget(id, value);
    },
    toast,
    copyText,
    flash,
    secret: {
      get: (name) => (keys[id] && keys[id][name]) || '',
      set: (name, value) => {
        keys[id] = { ...(keys[id] || {}), [name]: value };
        return secrets.save(id, keys[id]);
      },
    },
    cache: {
      get: () => (fetched[id] && typeof fetched[id] === 'object' ? fetched[id] : {}),
      set: (value) => {
        fetched[id] = value;
        return cache.save(id, value);
      },
    },
    alerts: (list) => onAlerts(id, list),
  });

  function flash(el, msg) {
    el.dataset.flash = msg;
    el.classList.add('flashed');
    clearTimeout(el._flashTimer);
    el._flashTimer = setTimeout(() => el.classList.remove('flashed'), 1200);
    announcer.textContent = msg;
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wcopy]');
    if (!b) return;
    const ok = await copyText(b.dataset.wcopy);
    flash(b, ok ? 'Copied' : 'Couldn’t copy');
  });

  function mount(id) {
    const section = document.createElement('section');
    section.className = 'widget';
    section.dataset.widget = id;
    section.setAttribute('aria-labelledby', `w-${id}-h`);
    section.innerHTML = `<header class="w-head"><h2 id="w-${id}-h">${esc(WIDGETS[id].name)}</h2><div class="w-tools"></div></header><div class="w-body"></div>`;
    const inst = FACTORIES[id](section.querySelector('.w-body'), ctxFor(id), section.querySelector('.w-tools'));
    return { section, inst };
  }

  // Shows the widgets that are on, in their order. Widgets already showing keep what's
  // typed in them; only added or removed ones are built or taken away.
  function render(settings, { show = true } = {}) {
    const ids = show ? settings.widgets.filter((w) => w.on && FACTORIES[w.id]).map((w) => w.id) : [];
    document.body.classList.toggle('has-widgets', ids.length > 0);
    root.hidden = !ids.length;
    if (ids.join() === order.join()) return;
    for (const [id, m] of live) {
      if (!ids.includes(id)) {
        if (m.inst.destroy) m.inst.destroy();
        m.section.remove();
        live.delete(id);
      }
    }
    const fresh = [];
    for (const id of ids) {
      if (!live.has(id)) {
        live.set(id, mount(id));
        fresh.push(id);
      }
      root.appendChild(live.get(id).section);
    }
    order = ids;
    const now = new Date();
    fresh.forEach((id) => live.get(id).inst.tick && live.get(id).inst.tick(now, true));
  }

  // Another tab (or a backup) changed what the widgets hold, or fetched something new.
  async function refresh() {
    [data, keys, fetched] = await Promise.all([loadWidgetData(), secrets.load(), cache.load()]);
    for (const { inst } of live.values()) if (inst.refresh) inst.refresh();
  }

  // One clock for every widget, lined up with the second and paused while the tab is hidden.
  let timer = null;
  const tick = () => {
    const now = new Date();
    for (const { inst } of live.values()) if (inst.tick) inst.tick(now, false);
  };
  function start() {
    stop();
    timer = setTimeout(() => {
      tick();
      timer = setInterval(tick, 1000);
    }, 1005 - (Date.now() % 1000));
  }
  function stop() {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
  // Typing is saved shortly after it stops; leaving the page saves anything still waiting.
  const flushAll = () => {
    for (const { inst } of live.values()) if (inst.flush) inst.flush();
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushAll();
      return stop();
    }
    tick();
    start();
  });
  start();

  return {
    async load() {
      [data, keys, fetched] = await Promise.all([loadWidgetData(), secrets.load(), cache.load()]);
    },
    render,
    refresh,
    getData: () => data,
    // From the alert banner: hide this alert until what's wrong changes.
    dismiss(id, key, sig) {
      const m = live.get(id);
      if (m && m.inst.dismiss) m.inst.dismiss(key, sig);
    },
  };
}

// --- Clocks ------------------------------------------------------------------------------
const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

// Older zone names some browsers still report, with the names people use now.
const CITY_NAMES = {
  'Asia/Calcutta': 'Kolkata',
  'Asia/Saigon': 'Ho Chi Minh City',
  'Europe/Kiev': 'Kyiv',
  'Asia/Rangoon': 'Yangon',
  'Asia/Katmandu': 'Kathmandu',
  'America/Buenos_Aires': 'Buenos Aires',
  'Atlantic/Faeroe': 'Faroe Islands',
};

const ALL_ZONES = (() => {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    if (list && list.length) return list;
  } catch { /* older browser */ }
  return [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
    'Pacific/Honolulu', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin',
    'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Warsaw', 'Europe/Kyiv',
    'Europe/Istanbul', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
    'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Cairo',
  ];
})();

const cityOf = (tz) => (tz === 'UTC' || tz === 'Etc/UTC' ? 'UTC' : CITY_NAMES[tz] || tz.split('/').pop().replace(/_/g, ' '));

function validZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function resolveZone(text) {
  const norm = (s) => s.toLowerCase().replace(/[\s_]+/g, ' ').trim();
  const n = norm(text);
  if (!n) return null;
  let hit =
    ALL_ZONES.find((z) => norm(z) === n) ||
    ALL_ZONES.find((z) => norm(cityOf(z)) === n) ||
    ALL_ZONES.find((z) => norm(z.split('/').pop()) === n);
  if (!hit) {
    const partial = ALL_ZONES.filter((z) => norm(z).includes(n) || norm(cityOf(z)).includes(n));
    if (partial.length === 1) hit = partial[0];
  }
  if (!hit && validZone(text.trim())) hit = text.trim(); // names like EST5EDT
  return hit || null;
}

const fmtCache = new Map();
function fmt(locale, opts) {
  const key = locale + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(locale, opts));
  return fmtCache.get(key);
}

// The date and time on the wall in a zone, as numbers.
function wall(tz, date) {
  const f = fmt('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function offsetMinutes(tz, date) {
  const w = wall(tz, date);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function offsetLabel(mins) {
  if (mins === 0) return 'Same time';
  const sign = mins > 0 ? '+' : '−';
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h}h${m ? ` ${m}m` : ''}`;
}

const localeHour12 = (() => {
  try {
    return !!new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
  } catch {
    return false;
  }
})();

function clocks(el, ctx, tools) {
  let editing = false;
  let lastMinute = -1;

  const state = () => {
    const d = ctx.get();
    const zones = Array.isArray(d.zones)
      ? d.zones.filter((z) => z && typeof z.tz === 'string' && validZone(z.tz)).map((z) => ({ tz: z.tz, label: typeof z.label === 'string' ? z.label : '' }))
      : [];
    return { zones, hour12: typeof d.hour12 === 'boolean' ? d.hour12 : localeHour12 };
  };
  const save = (patch) => ctx.save({ ...ctx.get(), ...patch });

  tools.innerHTML = `<button type="button" class="btn small quiet" data-edit aria-pressed="false">Edit</button>`;
  const editBtn = tools.querySelector('[data-edit]');

  el.innerHTML = `
    <div class="clk-main">
      <div class="clk-now" data-now aria-live="off"></div>
      <div class="clk-sub" data-sub></div>
    </div>
    <ul class="clk-list" data-list></ul>
    <div class="clk-editor" data-editor hidden>
      <form class="clk-add" data-add>
        <input class="input" name="zone" list="shelfmark-zones" autocomplete="off" spellcheck="false" placeholder="Add a city or time zone" aria-label="City or time zone to add" />
        <button type="submit" class="btn">Add</button>
      </form>
      <p class="w-error" data-add-error hidden></p>
      <datalist id="shelfmark-zones">${ALL_ZONES.map((z) => `<option value="${esc(z)}">${esc(cityOf(z))}</option>`).join('')}</datalist>
      <div class="seg small" role="radiogroup" aria-label="Clock style">
        <label><input type="radio" name="clk-hours" value="12" /><span>12-hour</span></label>
        <label><input type="radio" name="clk-hours" value="24" /><span>24-hour</span></label>
      </div>
    </div>`;
  const nowEl = el.querySelector('[data-now]');
  const subEl = el.querySelector('[data-sub]');
  const listEl = el.querySelector('[data-list]');
  const editor = el.querySelector('[data-editor]');
  const addForm = el.querySelector('[data-add]');
  const addErr = el.querySelector('[data-add-error]');

  function rowsHtml() {
    const { zones } = state();
    const rows = [{ tz: 'UTC', label: 'UTC', fixed: true }, ...zones];
    return rows
      .map((z, i) => {
        const name = z.label || cityOf(z.tz);
        const nameCell = editing && !z.fixed
          ? `<input class="input small clk-rename" data-rename="${i - 1}" value="${esc(name)}" aria-label="Name for ${esc(z.tz)}" />`
          : `<span class="clk-name" title="${esc(z.tz)}">${esc(name)}</span>`;
        const remove = editing && !z.fixed
          ? `<button type="button" class="icon-btn" data-remove="${i - 1}" aria-label="Remove ${esc(name)}" title="Remove">${ICONS.close}</button>`
          : '';
        return `<li class="clk-row" data-tz="${esc(z.tz)}">${nameCell}<span class="clk-meta" data-meta></span><span class="clk-t" data-t></span>${remove}</li>`;
      })
      .join('');
  }

  function drawList() {
    listEl.innerHTML = rowsHtml();
    listEl.classList.toggle('editing', editing);
    lastMinute = -1;
  }

  function update(now, full) {
    const { hour12 } = state();
    const parts = fmt(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12 }).formatToParts(now);
    let hm = '';
    let ss = '';
    let ap = '';
    let seenSecond = false;
    for (const p of parts) {
      if (p.type === 'second') { ss = p.value; seenSecond = true; }
      else if (p.type === 'dayPeriod') ap = p.value;
      else if (!seenSecond && p.type !== 'literal') hm += p.value;
      else if (!seenSecond && p.type === 'literal' && hm && !/\s/.test(p.value)) hm += p.value;
    }
    hm = hm.replace(/[:.]$/, '');
    nowEl.innerHTML = `<span class="hm">${esc(hm)}</span><span class="ss">${esc(ss)}</span>${ap ? `<span class="ap">${esc(ap)}</span>` : ''}`;

    if (!full && now.getMinutes() === lastMinute) return;
    lastMinute = now.getMinutes();
    subEl.textContent = `${fmt(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now)} · ${cityOf(LOCAL_TZ)}`;

    const localOff = offsetMinutes(LOCAL_TZ, now);
    const lw = wall(LOCAL_TZ, now);
    const localDay = dayNum(lw.y, lw.m, lw.d);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const li of listEl.children) {
      const tz = li.dataset.tz;
      const w = wall(tz, now);
      const dayDiff = dayNum(w.y, w.m, w.d) - localDay;
      const meta = [offsetLabel(offsetMinutes(tz, now) - localOff)];
      if (dayDiff) meta.push(capFirst(rtf.format(dayDiff, 'day')));
      li.querySelector('[data-meta]').textContent = meta.join(' · ');
      li.querySelector('[data-t]').textContent = fmt(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12 }).format(now);
    }
  }

  function setEditing(on) {
    editing = on;
    editor.hidden = !on;
    editBtn.textContent = on ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(on));
    const h12 = state().hour12;
    el.querySelectorAll('input[name="clk-hours"]').forEach((r) => (r.checked = r.value === (h12 ? '12' : '24')));
    addErr.hidden = true;
    drawList();
    update(new Date(), true);
    if (on) addForm.elements.zone.focus();
  }

  editBtn.addEventListener('click', () => setEditing(!editing));

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = addForm.elements.zone;
    const tz = resolveZone(input.value);
    const showErr = (m) => {
      addErr.textContent = m;
      addErr.hidden = false;
    };
    if (!tz) return showErr('Pick a city or zone from the list, like London or America/Chicago.');
    const { zones } = state();
    if (tz === 'UTC' || tz === 'Etc/UTC' || zones.some((z) => z.tz === tz)) return showErr(`${cityOf(tz)} is already on the list.`);
    addErr.hidden = true;
    input.value = '';
    await save({ zones: [...zones, { tz, label: '' }] });
    drawList();
    update(new Date(), true);
    input.focus();
  });

  listEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const i = Number(b.dataset.remove);
    const zones = state().zones;
    zones.splice(i, 1);
    await save({ zones });
    drawList();
    update(new Date(), true);
    const next = listEl.querySelector(`[data-remove="${Math.min(i, zones.length - 1)}"]`);
    (next || addForm.elements.zone).focus();
  });

  listEl.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-rename]');
    if (!inp) return;
    const zones = state().zones;
    const z = zones[Number(inp.dataset.rename)];
    if (!z) return;
    const v = inp.value.trim();
    z.label = v && v !== cityOf(z.tz) ? v : '';
    await save({ zones });
  });

  editor.addEventListener('change', async (e) => {
    if (e.target.name !== 'clk-hours') return;
    await save({ hour12: e.target.value === '12' });
    drawList();
    update(new Date(), true);
  });

  drawList();
  let shown = JSON.stringify(state());
  return {
    tick: (now, full) => update(now, full),
    refresh() {
      const s = JSON.stringify(state());
      if (s === shown) return;
      shown = s;
      if (el.contains(document.activeElement) && editing) return; // don't redraw under someone typing
      drawList();
      update(new Date(), true);
    },
  };
}

// --- Date math -----------------------------------------------------------------------------
function dates(el, ctx) {
  const d0 = ctx.get();
  const st = {
    mode: d0.mode === 'add' ? 'add' : 'between',
    inclusive: d0.inclusive === true,
    op: d0.op === '-' ? '-' : '+',
    amount: Number.isFinite(d0.amount) ? d0.amount : 30,
    unit: UNITS.includes(d0.unit) ? d0.unit : 'days',
  };
  let base = today();

  el.innerHTML = `
    <div class="seg small dm-mode" role="radiogroup" aria-label="What to work out">
      <label><input type="radio" name="dm-mode" value="between" /><span>Between dates</span></label>
      <label><input type="radio" name="dm-mode" value="add" /><span>Add or subtract</span></label>
    </div>
    <div class="dm-pane" data-pane="between">
      <div class="dm-two">
        <label class="field"><span>From</span><input type="date" class="input" data-from /></label>
        <label class="field"><span>To</span><input type="date" class="input" data-to /></label>
      </div>
      <label class="check small"><input type="checkbox" data-incl /> Count both dates</label>
    </div>
    <div class="dm-pane" data-pane="add" hidden>
      <label class="field"><span>Start</span><input type="date" class="input" data-start /></label>
      <div class="dm-amount">
        <select class="select" data-op aria-label="Add or subtract"><option value="+">Plus</option><option value="-">Minus</option></select>
        <input type="number" class="input" data-amount min="0" max="100000" step="1" inputmode="numeric" aria-label="How many" />
        <select class="select" data-unit aria-label="Unit">${UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}</select>
      </div>
    </div>
    <div class="w-out" data-out aria-live="polite"></div>
    <p class="w-foot" data-foot></p>`;

  const $ = (s) => el.querySelector(s);
  const from = $('[data-from]');
  const to = $('[data-to]');
  const incl = $('[data-incl]');
  const start = $('[data-start]');
  const op = $('[data-op]');
  const amount = $('[data-amount]');
  const unit = $('[data-unit]');
  const out = $('[data-out]');
  const foot = $('[data-foot]');

  el.querySelectorAll('input[name="dm-mode"]').forEach((r) => (r.checked = r.value === st.mode));
  from.value = toInput(base);
  start.value = toInput(base);
  const savedTo = fromInput(d0.to);
  if (savedTo !== null) to.value = toInput(savedTo);
  incl.checked = st.inclusive;
  op.value = st.op;
  amount.value = String(st.amount);
  unit.value = st.unit;

  const persist = debounce(() => {
    ctx.save({ mode: st.mode, to: to.value || null, inclusive: incl.checked, op: op.value, amount: Number(amount.value) || 0, unit: unit.value });
  }, 400);

  function relDays(n) {
    const diff = n - today();
    if (diff === 0) return 'today';
    return diff > 0 ? `in ${plural(diff, 'day')}` : `${plural(-diff, 'day')} ago`;
  }

  function update() {
    el.querySelectorAll('.dm-pane').forEach((p) => (p.hidden = p.dataset.pane !== st.mode));
    if (st.mode === 'between') {
      const a = fromInput(from.value);
      const b = fromInput(to.value);
      if (a === null || b === null) {
        out.innerHTML = `<p class="w-hint">Pick ${a === null && b === null ? 'two dates' : a === null ? 'a From date' : 'a To date'}.</p>`;
        return;
      }
      const r = between(a, b, { inclusive: incl.checked });
      const lines = [];
      if (r.years || r.months) {
        lines.push([r.years && plural(r.years, 'year'), r.months && plural(r.months, 'month'), r.restDays && plural(r.restDays, 'day')].filter(Boolean).join(', '));
      }
      if (r.days >= 7) lines.push([plural(r.weeks, 'week'), r.weekRest && plural(r.weekRest, 'day')].filter(Boolean).join(', '));
      lines.push(`${plural(r.weekdays, 'weekday')} (Mon–Fri)`);
      out.innerHTML = `
        <div class="w-big">${copyBtn(plural(r.days, 'day'), String(r.days))}</div>
        <ul class="w-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${r.backwards ? '<p class="w-hint">To is before From.</p>' : ''}`;
    } else {
      const s = fromInput(start.value);
      const k = Math.min(100000, Math.max(0, Math.trunc(Number(amount.value) || 0)));
      if (s === null) {
        out.innerHTML = '<p class="w-hint">Pick a start date.</p>';
        return;
      }
      const t = addToDate(s, op.value === '-' ? -k : k, unit.value);
      const iso = toInput(t);
      out.innerHTML = `
        <div class="w-big">${copyBtn(formatDay(t, 'full'), iso)}</div>
        <ul class="w-lines"><li>${copyBtn(iso, iso, 'code small')} · ${esc(relDays(t))}</li>${
          unit.value === 'weekdays' ? '<li class="w-hint">Skips Saturdays and Sundays, not holidays.</li>' : ''
        }${unit.value === 'months' || unit.value === 'years' ? '<li class="w-hint">A day that doesn’t exist in the new month becomes its last day.</li>' : ''}</ul>`;
    }
  }

  function updateFoot() {
    const w = isoWeek(base);
    const y = dayOfYear(base);
    foot.textContent = `Today is ${formatDay(base, 'short')} · Week ${w.week} · Day ${y.day} of ${y.of}`;
  }

  el.addEventListener('input', (e) => {
    if (e.target.name === 'dm-mode') st.mode = e.target.value;
    update();
    persist();
  });
  el.addEventListener('change', (e) => {
    if (e.target.name === 'dm-mode') st.mode = e.target.value;
    update();
    persist();
  });

  update();
  updateFoot();
  return {
    flush: () => persist.flush(),
    destroy: () => persist.flush(),
    tick(now, full) {
      const t = today(now);
      if (t === base && !full) return;
      // Past midnight: dates that were "today" move along with it.
      if (from.value === toInput(base)) from.value = toInput(t);
      if (start.value === toInput(base)) start.value = toInput(t);
      base = t;
      updateFoot();
      update();
    },
  };
}

// --- Scratchpad -----------------------------------------------------------------------------
function scratch(el, ctx) {
  el.innerHTML = `
    <textarea class="textarea scratch" data-text rows="6" spellcheck="true" placeholder="Notes, commands, addresses. Saved as you type." aria-label="Scratchpad"></textarea>
    <div class="w-actions">
      <span class="w-status" data-status></span>
      <span class="spacer"></span>
      <button type="button" class="btn small quiet" data-copyall>Copy all</button>
      <button type="button" class="btn small quiet" data-clear>Clear</button>
    </div>`;
  const ta = el.querySelector('[data-text]');
  const status = el.querySelector('[data-status]');
  ta.value = ctx.get().text || '';

  const autosize = () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 132), 440) + 'px';
  };
  let statusTimer = null;
  const persist = debounce(async () => {
    await ctx.save({ text: ta.value, updated: Date.now() });
    status.textContent = 'Saved';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ''), 1600);
  }, 400);

  ta.addEventListener('input', () => {
    autosize();
    status.textContent = '';
    persist();
  });
  ta.addEventListener('blur', () => persist.flush());

  el.querySelector('[data-copyall]').addEventListener('click', async (e) => {
    if (!ta.value) return ctx.flash(e.currentTarget, 'Nothing to copy');
    const ok = await ctx.copyText(ta.value);
    ctx.flash(e.currentTarget, ok ? 'Copied' : 'Couldn’t copy');
  });
  el.querySelector('[data-clear]').addEventListener('click', async () => {
    if (!ta.value) return;
    const before = ta.value;
    ta.value = '';
    autosize();
    await ctx.save({ text: '', updated: Date.now() });
    ctx.toast('Scratchpad cleared', {
      action: 'Undo',
      onAction: async () => {
        ta.value = before;
        autosize();
        await ctx.save({ text: before, updated: Date.now() });
      },
    });
  });

  return {
    tick(now, full) {
      if (full) autosize();
    },
    refresh() {
      if (document.activeElement === ta) return; // last edit here wins
      const v = ctx.get().text || '';
      if (v !== ta.value) {
        ta.value = v;
        autosize();
      }
    },
    flush: () => persist.flush(),
    destroy: () => persist.flush(),
  };
}

// --- Subnet calculator ----------------------------------------------------------------------
function subnet(el, ctx) {
  el.innerHTML = `
    <input class="input code" data-in spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="10.20.0.0/22" aria-label="Network, or address and mask" aria-describedby="subnet-tip" />
    <div class="w-out" data-out></div>
    <p class="w-foot" id="subnet-tip">↑ and ↓ in the box change the prefix.</p>`;
  const input = el.querySelector('[data-in]');
  const out = el.querySelector('[data-out]');
  input.value = ctx.get().input || '';
  const persist = debounce(() => ctx.save({ input: input.value.trim() }), 500);

  function update() {
    const r = parseSubnet(input.value);
    if (!r) {
      out.innerHTML = '<p class="w-hint">Type a network, or an address with its mask: 10.20.0.0/22, 192.168.1.10 255.255.255.0, or 2001:db8::/48.</p>';
      return;
    }
    if (r.error) {
      out.innerHTML = `<p class="w-error">${esc(r.error)}</p>`;
      return;
    }
    const rows =
      r.version === 4
        ? [
            ['Network', r.cidr],
            !r.isNetworkAddress && ['Address', r.address],
            ['Mask', r.mask, null, `/${r.prefix}`],
            ['Wildcard', r.wildcard],
            r.broadcast && ['Broadcast', r.broadcast],
            ['Usable', r.first === r.last ? r.first : `${r.first} – ${r.last}`, r.first === r.last ? r.first : `${r.first}-${r.last}`],
            ['Hosts', `${num(r.usable)} usable`, String(r.usable), `of ${num(r.total)}`, ''],
            ['Type', r.kind, false],
          ]
        : [
            ['Network', r.cidr],
            !r.isNetworkAddress && ['Address', r.address],
            ['Expanded', r.expanded],
            ['First', r.first],
            ['Last', r.last],
            ['Addresses', r.total.exact || r.total.power, r.total.exact ? r.total.exact.replace(/\D/g, '') : r.total.power, r.total.exact ? esc(r.total.power) : esc(r.total.approx)],
            r.subnets64 && ['/64 networks', r.subnets64.exact || r.subnets64.power, r.subnets64.exact ? r.subnets64.exact.replace(/\D/g, '') : r.subnets64.power, r.subnets64.exact ? '' : esc(r.subnets64.approx)],
            ['Type', r.kind, false],
          ];
    out.innerHTML = kvList(rows) + (r.note ? `<p class="w-hint">${esc(r.note)}</p>` : '');
  }

  input.addEventListener('input', () => {
    update();
    persist();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const r = parseSubnet(input.value);
    if (!r || r.error) return;
    e.preventDefault();
    const max = r.version === 4 ? 32 : 128;
    const p = Math.min(max, Math.max(0, r.prefix + (e.key === 'ArrowUp' ? 1 : -1)));
    input.value = `${r.address}/${p}`;
    update();
    persist();
  });
  update();
  return { flush: () => persist.flush(), destroy: () => persist.flush() };
}

// --- Timestamp converter ----------------------------------------------------------------------
function timestamp(el, ctx) {
  const saved = ctx.get();
  el.innerHTML = `
    <div class="ts-now">
      <span class="ts-now-label">Now</span>
      <button type="button" class="kv-val code" data-now title="Copy"></button>
      <span class="spacer"></span>
      <button type="button" class="btn small quiet" data-use-now>Convert now</button>
    </div>
    <input class="input code" data-in spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="1760385600 or 2026-10-13 15:30" aria-label="Timestamp or date to convert" />
    <label class="ts-read" data-readrow hidden><span>Read as</span>
      <select class="select small" data-read>
        <option value="auto">Detect automatically</option>
        ${READ_ORDER.map((k) => `<option value="${k}">${esc(READS[k])}</option>`).join('')}
      </select>
    </label>
    <div class="w-out" data-out></div>`;
  const input = el.querySelector('[data-in]');
  const read = el.querySelector('[data-read]');
  const readRow = el.querySelector('[data-readrow]');
  const out = el.querySelector('[data-out]');
  const nowBtn = el.querySelector('[data-now]');
  input.value = saved.input || '';
  read.value = READS[saved.read] ? saved.read : 'auto';

  const persist = debounce(() => ctx.save({ input: input.value.trim(), read: read.value }), 500);
  let shownMs = null;

  function update() {
    const p = parseTimestamp(input.value, read.value);
    readRow.hidden = !(p && p.numeric);
    read.options[0].textContent = p && p.numeric && p.guessed ? `Detected: ${READS[p.read]}` : 'Detect automatically';
    shownMs = null;
    if (!p) {
      out.innerHTML = '<p class="w-hint">Paste a Unix time (1760385600), an Active Directory time (134047680000000000), an LDAP time (20261013195800.0Z), or a date (2026-10-13 15:30).</p>';
      return;
    }
    if (p.error) {
      out.innerHTML = `<p class="w-error">${esc(p.error)}</p>`;
      return;
    }
    if (p.never) {
      out.innerHTML = `<p class="w-note">${esc(p.never)}</p>`;
      return;
    }
    const d = describeInstant(p.ns);
    if (d.error) {
      out.innerHTML = `<p class="w-error">${esc(d.error)}</p>`;
      return;
    }
    shownMs = d.ms;
    out.innerHTML =
      kvList([
        ['Your time', d.local, null, `<span data-rel>${esc(capFirst(d.relative))}</span>`, ''],
        ['UTC', d.utc],
        ['ISO 8601', d.iso],
        ['Unix', d.unix, null, 'seconds'],
        ['Unix ms', d.unixms],
        d.filetime && ['AD time', d.filetime, null, 'Windows FILETIME'],
        d.ldap && ['LDAP', d.ldap],
      ]) + (p.note ? `<p class="w-hint">${esc(p.note)}</p>` : '');
  }

  input.addEventListener('input', () => {
    update();
    persist();
  });
  read.addEventListener('change', () => {
    update();
    persist();
  });
  el.querySelector('[data-use-now]').addEventListener('click', () => {
    input.value = String(Math.floor(Date.now() / 1000));
    read.value = 'auto';
    update();
    persist();
    input.focus();
  });

  function tickNow(now) {
    const s = String(Math.floor(now.getTime() / 1000));
    nowBtn.textContent = s;
    nowBtn.dataset.wcopy = s;
  }

  update();
  return {
    tick(now) {
      tickNow(now);
      if (shownMs !== null && now.getSeconds() % 5 === 0) {
        const rel = out.querySelector('[data-rel]');
        if (rel) rel.textContent = capFirst(relativeTime(shownMs, now.getTime()));
      }
    },
    flush: () => persist.flush(),
    destroy: () => persist.flush(),
  };
}

const FACTORIES = { clocks, dates, scratch, subnet, timestamp, weather, outages, traffic };

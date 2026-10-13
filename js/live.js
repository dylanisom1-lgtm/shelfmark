// Widgets with live data: weather (Open-Meteo), outages (status pages) and traffic (Google).
// They refresh only while Shelfmark is showing; the panel stops ticking when the tab is hidden
// and ticks once as soon as it's back. Results are cached (not exported) so other Shelfmark
// tabs share them instead of asking again.

import { MODE } from '../lib/browser.js';
import { IS_WEB } from '../lib/store.js';
import { getJson, getText, request, NetError, askForSite, canAskForSites } from '../lib/net.js';
import { describeCode, geocodeUrl, parseGeocode, placeLabel, forecastUrl, parseForecast, defaultUnits, UNITS, hourLabel, timeLabel, dayLabel } from '../lib/weather.js';
import { PRESETS, LEVEL_TEXT, sourceUrl, needsSitePermission, guessSource, parseStatuspage, parseFeed, parseSlack, signature } from '../lib/status.js';
import {
  parseMapsLink, mapsLinkFor, defaultName, routesRequest, parseRoutes, routesError, INTERVALS, withinHours,
  monthlyEstimate, formatDuration, formatDistance, trafficLevel, usesMiles, FREE_PER_MONTH,
} from '../lib/routes.js';
import { ICONS } from '../lib/icons.js';
import { esc, num, clockTime, ago } from './wkit.js';

const uid = (p) => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
const PREVIEW = MODE === 'preview';

// Words for a failed request, shared by the three widgets.
function failure(err, what) {
  const kind = err && err.kind;
  if (kind === 'offline') return 'You’re offline.';
  if (kind === 'timeout') return `${what} didn’t answer in time.`;
  if (kind === 'preview') return 'The preview shows sample data.';
  if (kind === 'http') return `${what} answered with an error (${err.status}).`;
  if (kind === 'blocked') return `Couldn’t reach ${what}.`;
  return `${what} sent something unexpected.`;
}

const errInfo = (err, what) => ({ kind: (err && err.kind) || 'format', text: failure(err, what) });

function liveFoot(updatedText, source = '') {
  return `<p class="w-foot live-foot"><span data-updated>${updatedText}</span>${
    PREVIEW ? '' : ' · <button type="button" class="link-btn" data-refresh>Refresh</button>'
  }${source ? `<span class="spacer"></span>${source}` : ''}</p>`;
}

const external = (url, label, cls = '') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

// =========================================================================================
// Weather
// =========================================================================================
const cloud = (dy = 0) => `<path transform="translate(0 ${dy})" d="M7.4 18.6h9.4a3.8 3.8 0 0 0 .5-7.56 5.3 5.3 0 0 0-10.15-.3A3.95 3.95 0 0 0 7.4 18.6Z"/>`;
const sunRays = (cx, cy, r, len) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 2);
    const y1 = cy + Math.sin(a) * (r + 2);
    const x2 = cx + Math.cos(a) * (r + 2 + len);
    const y2 = cy + Math.sin(a) * (r + 2 + len);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }).join('');
const wx = (body) => `<svg class="wx" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const WX = {
  clear: wx(`<g class="sun"><circle cx="12" cy="12" r="4.2"/><path d="${sunRays(12, 12, 4.2, 2.6)}"/></g>`),
  'clear-night': wx(`<path class="moon" d="M19 14.6A7.5 7.5 0 0 1 9.4 5a7.5 7.5 0 1 0 9.6 9.6Z"/>`),
  partly: wx(`<g class="sun"><circle cx="8.6" cy="8.4" r="3"/><path d="${sunRays(8.6, 8.4, 3, 1.7)}"/></g>${cloud(1.6)}`),
  'partly-night': wx(`<path class="moon" d="M12.6 8.6A4.6 4.6 0 0 1 6.9 3a4.6 4.6 0 1 0 5.7 5.6Z"/>${cloud(1.6)}`),
  cloud: wx(cloud()),
  fog: wx(`${cloud(-3)}<path d="M4 18.5h16M6.5 21h11"/>`),
  drizzle: wx(`${cloud(-3)}<path d="M8.5 19.2v.2M12 20.4v.2M15.5 19.2v.2"/>`),
  rain: wx(`${cloud(-3)}<path d="m8.6 18.4-1 2.6M12.6 18.4l-1 2.6M16.6 18.4l-1 2.6"/>`),
  sleet: wx(`${cloud(-3)}<path d="m8.6 18.4-1 2.6M15.6 18.4l-1 2.6M12 19.6v.2"/>`),
  snow: wx(`${cloud(-3)}<path d="M8.5 18.6v2.4M7.3 19.8h2.4M15.5 18.6v2.4M14.3 19.8h2.4M12 20.4v.2"/>`),
  thunder: wx(`${cloud(-3)}<path class="bolt" d="m12.8 16.2-2.2 3.4h2.6l-1.6 3"/>`),
};
const wxIcon = (code, isDay) => WX[describeCode(code, isDay).icon] || WX.cloud;
const deg = (v) => (v === null || v === undefined ? '–' : `${v}°`);

export function weather(el, ctx, tools) {
  let editing = false;
  let busy = false;
  const open = new Set();

  const state = () => {
    const d = ctx.get();
    const places = Array.isArray(d.places)
      ? d.places.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.name === 'string')
      : [];
    return { places, units: UNITS[d.units] ? d.units : defaultUnits() };
  };
  const save = (patch) => ctx.save({ ...ctx.get(), ...patch });
  const keyOf = (s) => s.units + '|' + s.places.map((p) => `${p.lat},${p.lon}`).join(';');

  tools.innerHTML = `<button type="button" class="btn small quiet" data-edit aria-pressed="false">Edit</button>`;
  const editBtn = tools.querySelector('[data-edit]');
  el.innerHTML = `
    <div data-view></div>
    <div class="w-editor" data-editor hidden>
      <form class="inline-form" data-search>
        <input class="input" name="q" autocomplete="off" placeholder="City or postal code" aria-label="Place to add" />
        <button type="submit" class="btn">Search</button>
      </form>
      <p class="w-error" data-err hidden></p>
      <ul class="pick-list" data-results></ul>
      <div class="seg small" role="radiogroup" aria-label="Units">
        <label><input type="radio" name="wx-units" value="f" /><span>°F, mph</span></label>
        <label><input type="radio" name="wx-units" value="c" /><span>°C, km/h</span></label>
      </div>
    </div>
    <div data-foot></div>`;
  const view = el.querySelector('[data-view]');
  const editor = el.querySelector('[data-editor]');
  const form = el.querySelector('[data-search]');
  const errEl = el.querySelector('[data-err]');
  const results = el.querySelector('[data-results]');
  const foot = el.querySelector('[data-foot]');
  let found = [];

  function draw() {
    const s = state();
    const c = ctx.cache.get();
    const list = c.key === keyOf(s) && Array.isArray(c.list) ? c.list : null;
    if (!s.places.length) {
      view.innerHTML = `<p class="w-hint">Add places with <strong>Edit</strong>: your home, the office, anywhere you keep an eye on.</p>`;
    } else if (editing) {
      view.innerHTML = `<ul class="edit-list">${s.places
        .map(
          (p, i) => `<li><input class="input small" data-rename="${i}" value="${esc(p.label || placeLabel(p))}" aria-label="Name for ${esc(placeLabel(p))}" />
            <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(p.label || p.name)}" title="Remove">${ICONS.close}</button></li>`,
        )
        .join('')}</ul>`;
    } else {
      const u = UNITS[s.units];
      // Just the city, unless two saved places share a name.
      const shared = (p) => s.places.filter((x) => x.name === p.name).length > 1;
      view.innerHTML = s.places
        .map((p, i) => {
          const w = list ? list[i] : null;
          const name = esc(p.label || (shared(p) ? placeLabel(p) : p.name));
          if (!w) {
            return `<div class="wx-place"><div class="wx-row static"><span class="wx-ic">${WX.cloud}</span><span class="wx-name">${name}<small>${busy ? 'Loading…' : 'Not loaded yet'}</small></span></div></div>`;
          }
          const d = describeCode(w.code, w.isDay);
          const isOpen = open.has(p.id);
          const t = w.today;
          const hours = w.hours
            .map((h) => `<li><span class="wx-h">${esc(hourLabel(h.time))}</span>${wxIcon(h.code, h.isDay)}<span class="wx-t">${deg(h.temp)}</span><span class="wx-pop">${h.pop ? `${h.pop}%` : ''}</span></li>`)
            .join('');
          const days = w.days
            .map((x, j) => `<li><span class="wx-d">${esc(dayLabel(x.date, j))}</span>${wxIcon(x.code, true)}<span class="wx-range">${deg(x.max)} <span class="lo">${deg(x.min)}</span></span><span class="wx-pop">${x.pop ? `${x.pop}%` : ''}</span></li>`)
            .join('');
          const facts = [
            `Feels like ${deg(w.feels)}`,
            w.wind !== null ? `Wind ${w.wind} ${u.windLabel}${w.gusts && w.gusts > w.wind + 4 ? `, gusts ${w.gusts}` : ''}` : '',
            w.humidity !== null ? `Humidity ${w.humidity}%` : '',
          ].filter(Boolean);
          return `<div class="wx-place${isOpen ? ' open' : ''}" data-pid="${esc(p.id)}">
            <button type="button" class="wx-row" data-toggle="${esc(p.id)}" aria-expanded="${isOpen}">
              <span class="wx-ic">${wxIcon(w.code, w.isDay)}</span>
              <span class="wx-name">${name}<small>${esc(d.text)}</small></span>
              <span class="wx-temp">${deg(w.temp)}</span>
              <span class="wx-hl">${t ? `${deg(t.max)} <span class="lo">${deg(t.min)}</span>` : ''}${t && t.pop ? `<small>${t.pop}% rain</small>` : ''}</span>
            </button>
            <div class="wx-more"${isOpen ? '' : ' hidden'}>
              <p class="wx-facts">${facts.map(esc).join(' · ')}</p>
              ${hours ? `<ol class="wx-hours">${hours}</ol>` : ''}
              <ol class="wx-days">${days}</ol>
              <p class="w-hint">${w.sunrise ? `Sunrise ${esc(timeLabel(w.sunrise))} · Sunset ${esc(timeLabel(w.sunset))} · ` : ''}Local time ${esc(timeLabel(w.time))}${w.tz ? ` ${esc(w.tz)}` : ''}</p>
            </div>
          </div>`;
        })
        .join('');
    }
    let updated = '';
    if (busy) updated = 'Updating…';
    else if (c.error && c.errAt) updated = `<span class="w-error-inline">${esc(c.error.text)}</span>${list ? ` Showing ${esc(clockTime(c.at))}.` : ''}`;
    else if (list) updated = `Updated ${esc(clockTime(c.at))}`;
    foot.innerHTML = s.places.length || editing ? liveFoot(updated, external('https://open-meteo.com/', 'Weather by Open-Meteo')) : '';
  }

  async function load(force = false) {
    const s = state();
    if (!s.places.length || busy || PREVIEW) return;
    const c = ctx.cache.get();
    const key = keyOf(s);
    const fresh = c.key === key && Date.now() - (c.at || 0) < 15 * 60e3;
    const recentFail = c.errAt && Date.now() - c.errAt < 2 * 60e3;
    if (!force && (fresh || recentFail)) return;
    busy = true;
    draw();
    try {
      const list = parseForecast(await getJson(forecastUrl(s.places, s.units)), s.places.length);
      await ctx.cache.set({ key, at: Date.now(), list });
    } catch (err) {
      const keep = c.key === key ? c : {};
      await ctx.cache.set({ ...keep, error: errInfo(err instanceof NetError ? err : null, 'Open-Meteo'), errAt: Date.now() });
    } finally {
      busy = false;
      draw();
    }
  }

  function setEditing(on) {
    editing = on;
    editor.hidden = !on;
    editBtn.textContent = on ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(on));
    const s = state();
    el.querySelectorAll('input[name="wx-units"]').forEach((r) => (r.checked = r.value === s.units));
    errEl.hidden = true;
    results.innerHTML = '';
    draw();
    if (on) form.elements.q.focus();
    else load();
  }
  editBtn.addEventListener('click', () => setEditing(!editing));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = form.elements.q.value.trim();
    errEl.hidden = true;
    results.innerHTML = '';
    if (q.length < 2) return;
    if (PREVIEW) {
      errEl.textContent = 'Searching for places works on the website and in the extension.';
      errEl.hidden = false;
      return;
    }
    try {
      found = parseGeocode(await getJson(geocodeUrl(q, (navigator.language || 'en'))));
      if (!found.length) {
        errEl.textContent = `No places called “${q}”. Try the city name, or add the state or country.`;
        errEl.hidden = false;
        return;
      }
      results.innerHTML = found
        .map((p, i) => `<li><button type="button" class="pick" data-pick="${i}"><strong>${esc(p.name)}</strong> <span>${esc([p.admin, p.country].filter(Boolean).join(', '))}</span></button></li>`)
        .join('');
      results.querySelector('button').focus();
    } catch (err) {
      errEl.textContent = failure(err, 'Open-Meteo');
      errEl.hidden = false;
    }
  });

  results.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const p = found[Number(b.dataset.pick)];
    const s = state();
    if (s.places.some((x) => Math.abs(x.lat - p.lat) < 0.01 && Math.abs(x.lon - p.lon) < 0.01)) {
      errEl.textContent = `${placeLabel(p)} is already on the list.`;
      errEl.hidden = false;
      return;
    }
    await save({ places: [...s.places, { id: uid('p'), ...p, label: '' }] });
    results.innerHTML = '';
    form.elements.q.value = '';
    draw();
    form.elements.q.focus();
    load(true);
  });

  view.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const id = t.dataset.toggle;
      if (open.has(id)) open.delete(id);
      else open.add(id);
      const place = t.closest('.wx-place');
      place.classList.toggle('open', open.has(id));
      place.querySelector('.wx-more').hidden = !open.has(id);
      t.setAttribute('aria-expanded', String(open.has(id)));
      return;
    }
    const r = e.target.closest('[data-remove]');
    if (r) {
      const places = state().places;
      places.splice(Number(r.dataset.remove), 1);
      await save({ places });
      draw();
    }
  });
  view.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-rename]');
    if (!inp) return;
    const places = state().places;
    const p = places[Number(inp.dataset.rename)];
    if (!p) return;
    const v = inp.value.trim();
    p.label = v && v !== placeLabel(p) ? v : '';
    await save({ places });
  });
  editor.addEventListener('change', async (e) => {
    if (e.target.name !== 'wx-units') return;
    await save({ units: e.target.value });
    draw();
  });
  foot.addEventListener('click', (e) => {
    if (e.target.closest('[data-refresh]')) load(true);
  });

  draw();
  return {
    tick(now, full) {
      if (full) draw();
      if (!editing) load();
    },
    refresh() {
      if (editing && el.contains(document.activeElement)) return;
      draw();
    },
  };
}

// =========================================================================================
// Outages
// =========================================================================================
const CHECK_EVERY = 3 * 60e3;

export function outages(el, ctx, tools) {
  let editing = false;
  let busy = false;
  const section = () => el.closest('.widget');

  const state = () => {
    const d = ctx.get();
    const services = Array.isArray(d.services) ? d.services.filter((x) => x && x.id && x.kind && x.url) : [];
    return { services, dismissed: d.dismissed && typeof d.dismissed === 'object' ? d.dismissed : {} };
  };
  const save = (patch) => ctx.save({ ...ctx.get(), ...patch });

  tools.innerHTML = `<button type="button" class="btn small quiet" data-edit aria-pressed="false">Edit</button>`;
  const editBtn = tools.querySelector('[data-edit]');
  el.innerHTML = `
    <div data-view></div>
    <div class="w-editor" data-editor hidden>
      <div class="inline-form">
        <select class="select" data-preset aria-label="Service to add"></select>
        <button type="button" class="btn" data-add-preset>Add</button>
      </div>
      <form class="inline-form" data-custom>
        <input class="input" name="url" autocomplete="off" spellcheck="false" placeholder="Or any status page address" aria-label="Status page address" />
        <button type="submit" class="btn">Add</button>
      </form>
      <p class="w-error" data-err hidden></p>
      <p class="w-hint" data-source-hint></p>
    </div>
    <div data-foot></div>`;
  const view = el.querySelector('[data-view]');
  const editor = el.querySelector('[data-editor]');
  const presetSel = el.querySelector('[data-preset]');
  const custom = el.querySelector('[data-custom]');
  const errEl = el.querySelector('[data-err]');
  const foot = el.querySelector('[data-foot]');
  el.querySelector('[data-source-hint]').textContent = IS_WEB
    ? 'Most status pages run on Statuspage and work here. Microsoft, Azure, AWS, Google and Slack publish feeds that may not let websites read them; the extension can.'
    : 'Most status pages run on Statuspage. For Microsoft, Azure, AWS, Google and Slack, Shelfmark asks to read that site when you add it.';

  const results = () => {
    const c = ctx.cache.get();
    return c.results && typeof c.results === 'object' ? c.results : {};
  };

  function fillPresets() {
    const have = new Set(state().services.map((x) => x.preset).filter(Boolean));
    presetSel.innerHTML =
      `<option value="">Choose a service…</option>` +
      PRESETS.filter((p) => !have.has(p.id)).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  function problemsOf(r) {
    return r && r.result ? r.result : null;
  }

  function draw() {
    const s = state();
    const res = results();
    let bad = 0;
    if (!s.services.length) {
      view.innerHTML = `<p class="w-hint">Add the services you depend on with <strong>Edit</strong>. Problems show in a banner at the top of Shelfmark.</p>`;
    } else {
      view.innerHTML = `<ul class="st-list">${s.services
        .map((svc, i) => {
          const r = res[svc.id];
          const out = problemsOf(r);
          const level = out ? out.level : r && r.error ? 'unknown' : 'pending';
          if (level === 'warn' || level === 'down') bad++;
          const remove = editing ? `<button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(svc.name)}" title="Remove">${ICONS.close}</button>` : '';
          let status = level === 'pending' ? (busy ? 'Checking…' : 'Not checked yet') : out ? out.summary || LEVEL_TEXT[level] : LEVEL_TEXT.unknown;
          let detail = '';
          if (out && out.problems.length) {
            detail += `<ul class="st-problems">${out.problems
              .map((p) => `<li>${external(p.url || svc.url, esc(p.title))}<span class="st-meta">${[p.state, p.updated ? ago(p.updated) : ''].filter(Boolean).map(esc).join(' · ')}</span></li>`)
              .join('')}</ul>`;
          }
          if (out && out.components && out.components.length) {
            detail += `<p class="st-comps">${out.components.map((c) => `${esc(c.name)}: ${esc(c.text)}`).join(' · ')}</p>`;
          }
          if (!out && r && r.error) {
            const blocked = r.error.kind === 'blocked' && needsSitePermission(svc);
            let why = esc(r.error.text);
            if (blocked && IS_WEB) why = 'Its feed may not let websites read it. Installed as an extension, Shelfmark can.';
            detail += `<p class="st-err">${why}${blocked && canAskForSites ? ` <button type="button" class="link-btn" data-allow="${i}">Allow Shelfmark to read it</button>` : ''}</p>`;
          }
          if (editing && svc.note) detail += `<p class="w-hint">${esc(svc.note)}</p>`;
          return `<li class="st-row lvl-${level}">
            <span class="st-dot" aria-hidden="true"></span>
            ${external(svc.url, esc(svc.name), 'st-name')}
            <span class="st-text">${esc(status)}</span>${remove}
            ${detail ? `<div class="st-detail">${detail}</div>` : ''}
          </li>`;
        })
        .join('')}</ul>`;
    }
    const sec = section();
    if (sec) sec.classList.toggle('alarm', bad > 0);
    const c = ctx.cache.get();
    let updated = busy ? 'Checking…' : c.at ? `Checked ${esc(clockTime(c.at))}, every 3 minutes` : '';
    foot.innerHTML = s.services.length ? liveFoot(updated) : '';
    publishAlerts();
  }

  function publishAlerts() {
    const s = state();
    const res = results();
    const list = [];
    for (const svc of s.services) {
      const out = problemsOf(res[svc.id]);
      if (!out || (out.level !== 'warn' && out.level !== 'down')) continue;
      const sig = signature(out);
      if (s.dismissed[svc.id] === sig) continue;
      const first = out.problems[0];
      list.push({
        key: svc.id,
        sig,
        name: svc.name,
        level: out.level,
        text: first ? first.title : out.summary,
        state: first ? first.state : '',
        updated: first && first.updated,
        url: (first && first.url) || svc.url,
        more: Math.max(0, out.problems.length - 1),
      });
    }
    ctx.alerts(list);
  }

  async function checkOne(svc) {
    const url = sourceUrl(svc);
    try {
      let out;
      if (svc.kind === 'statuspage') out = parseStatuspage(await getJson(url));
      else if (svc.kind === 'slack') out = parseSlack(await getJson(url));
      else out = parseFeed(await getText(url), svc);
      return { at: Date.now(), result: { level: out.level, summary: out.summary, problems: out.problems, components: out.components } };
    } catch (err) {
      return { at: Date.now(), error: errInfo(err instanceof NetError ? err : null, svc.name) };
    }
  }

  async function check(force = false, only = null) {
    const s = state();
    if (!s.services.length || busy || PREVIEW) return;
    const c = ctx.cache.get();
    const res = results();
    const missing = s.services.some((x) => !res[x.id]);
    if (!force && !missing && Date.now() - (c.at || 0) < CHECK_EVERY) return;
    busy = true;
    draw();
    try {
      const targets = only ? s.services.filter((x) => x.id === only) : s.services;
      const done = await Promise.all(targets.map((x) => checkOne(x)));
      const next = { ...results() };
      targets.forEach((x, i) => (next[x.id] = done[i]));
      for (const id of Object.keys(next)) if (!s.services.some((x) => x.id === id)) delete next[id];
      await ctx.cache.set({ at: Date.now(), results: next });
      // A service that's fine again forgets its dismissed alert, so the next problem shows.
      const dismissed = { ...state().dismissed };
      let changed = false;
      for (const svc of s.services) {
        const out = problemsOf(next[svc.id]);
        if (dismissed[svc.id] && out && signature(out) !== dismissed[svc.id] && (out.level === 'ok' || out.level === 'info')) {
          delete dismissed[svc.id];
          changed = true;
        }
      }
      if (changed) await save({ dismissed });
    } finally {
      busy = false;
      draw();
    }
  }

  async function addService(svc) {
    const s = state();
    if (s.services.some((x) => sourceUrl(x) === sourceUrl(svc))) {
      errEl.textContent = `${svc.name} is already on the list.`;
      errEl.hidden = false;
      return false;
    }
    errEl.hidden = true;
    await save({ services: [...s.services, { id: uid('s'), ...svc }] });
    fillPresets();
    draw();
    check(true);
    return true;
  }

  function setEditing(on) {
    editing = on;
    editor.hidden = !on;
    editBtn.textContent = on ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(on));
    errEl.hidden = true;
    fillPresets();
    draw();
    if (on) presetSel.focus();
  }
  editBtn.addEventListener('click', () => setEditing(!editing));

  el.querySelector('[data-add-preset]').addEventListener('click', () => {
    const p = PRESETS.find((x) => x.id === presetSel.value);
    if (!p) return;
    const { id, ...rest } = p;
    const svc = { ...rest, preset: id };
    // Ask for the site straight from the click; the browser only allows it then.
    const asked = needsSitePermission(svc) ? askForSite(sourceUrl(svc)) : null;
    addService(svc).then((added) => {
      presetSel.focus();
      if (added && asked) asked.then((ok) => ok && recheck(sourceUrl(svc)));
    });
  });

  function recheck(url) {
    const svc = state().services.find((x) => sourceUrl(x) === url);
    if (!svc) return;
    if (busy) setTimeout(() => recheck(url), 500);
    else check(true, svc.id);
  }

  custom.addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = guessSource(custom.elements.url.value);
    if (!g) return;
    if (g.error) {
      errEl.textContent = g.error;
      errEl.hidden = false;
      return;
    }
    const asked = g.kind !== 'statuspage' ? askForSite(sourceUrl(g)) : null;
    if (asked) await asked; // the address has to be readable before Shelfmark can name it
    if (PREVIEW) {
      errEl.textContent = 'Adding your own status pages works on the website and in the extension.';
      errEl.hidden = false;
      return;
    }
    errEl.textContent = 'Looking…';
    errEl.hidden = false;
    let svc = null;
    try {
      if (g.kind === 'statuspage') {
        const out = parseStatuspage(await getJson(sourceUrl(g)));
        svc = { kind: 'statuspage', url: g.url, name: out.name || g.name };
      }
    } catch { /* not a Statuspage; maybe a feed */ }
    if (!svc && (g.kind === 'feed' || g.kind === 'slack' || g.maybeFeed)) {
      const feed = g.kind === 'statuspage' ? g.maybeFeed : sourceUrl(g);
      try {
        const out = g.kind === 'slack' ? parseSlack(await getJson(feed)) : parseFeed(await getText(feed), g);
        svc = g.kind === 'slack' ? { ...g } : { kind: 'feed', url: g.url, feed, name: (out.name || g.name).replace(/\s*(status|service health)?\s*(updates|feed)?\s*$/i, '').trim() || g.name };
      } catch { /* nothing readable */ }
    }
    if (!svc) {
      errEl.textContent = IS_WEB
        ? 'Couldn’t read a status page or feed there. Some providers don’t let websites read their status; the extension can.'
        : 'Couldn’t read a status page or feed at that address.';
      return;
    }
    if (await addService(svc)) custom.elements.url.value = '';
  });

  view.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-remove]');
    if (r) {
      const s = state();
      const [gone] = s.services.splice(Number(r.dataset.remove), 1);
      const dismissed = { ...s.dismissed };
      if (gone) delete dismissed[gone.id];
      await save({ services: s.services, dismissed });
      fillPresets();
      draw();
      return;
    }
    const a = e.target.closest('[data-allow]');
    if (a) {
      const svc = state().services[Number(a.dataset.allow)];
      if (!svc) return;
      askForSite(sourceUrl(svc)).then((ok) => ok && check(true, svc.id));
    }
  });
  foot.addEventListener('click', (e) => {
    if (e.target.closest('[data-refresh]')) check(true);
  });

  draw();
  return {
    tick(now, full) {
      if (full) draw();
      check();
    },
    refresh() {
      draw(); // the editor's fields sit outside what draw() replaces
    },
    async dismiss(key, sig) {
      const dismissed = { ...state().dismissed, [key]: sig };
      await save({ dismissed });
      publishAlerts();
    },
    destroy() {
      ctx.alerts([]);
      const sec = section();
      if (sec) sec.classList.remove('alarm');
    },
  };
}

// =========================================================================================
// Traffic
// =========================================================================================
export function traffic(el, ctx, tools) {
  let editing = false;
  let busy = false;
  const miles = usesMiles();

  const state = () => {
    const d = ctx.get();
    const routes = Array.isArray(d.routes) ? d.routes.filter((r) => r && r.id && r.origin && r.destination) : [];
    const h = d.hours && typeof d.hours === 'object' ? d.hours : {};
    return {
      routes,
      interval: INTERVALS.includes(d.interval) ? d.interval : 10,
      hours: {
        limit: h.limit !== false,
        from: /^\d{2}:\d{2}$/.test(h.from) ? h.from : '06:00',
        to: /^\d{2}:\d{2}$/.test(h.to) ? h.to : '19:00',
        weekdays: h.weekdays !== false,
      },
    };
  };
  const save = (patch) => ctx.save({ ...ctx.get(), ...patch });
  const key = () => ctx.secret.get('googleKey');

  tools.innerHTML = `<button type="button" class="btn small quiet" data-edit aria-pressed="false">Edit</button>`;
  const editBtn = tools.querySelector('[data-edit]');
  const siteRule = `${location.origin}/*`;
  el.innerHTML = `
    <div data-view></div>
    <div class="w-editor" data-editor hidden>
      <section class="ed-section">
        <h3>Google Maps API key</h3>
        <p class="w-hint" data-key-state></p>
        <form class="inline-form" data-key-form>
          <input class="input code" type="password" name="key" autocomplete="off" spellcheck="false" placeholder="Paste your API key" aria-label="Google Maps API key" />
          <button type="submit" class="btn">Save</button>
        </form>
        <details class="help">
          <summary>How to get a key</summary>
          <ol>
            <li>In the ${external('https://console.cloud.google.com/projectcreate', 'Google Cloud console')}, create a project and turn on billing for it. Google requires billing; up to ${num(FREE_PER_MONTH)} traffic requests a month are free.</li>
            <li>Turn on the ${external('https://console.cloud.google.com/apis/library/routes.googleapis.com', 'Routes API')} for the project.</li>
            <li>Under ${external('https://console.cloud.google.com/apis/credentials', 'Credentials')}, choose <strong>Create credentials › API key</strong>.</li>
            <li>Edit the key. Under <strong>API restrictions</strong>, allow only the Routes API.${
              IS_WEB
                ? ` Under <strong>Application restrictions</strong>, choose <strong>Websites</strong> and add <code>${esc(siteRule)}</code>.`
                : ' Leave <strong>Application restrictions</strong> off: an extension can’t prove which website it is.'
            }</li>
            <li>Optional: on the Routes API’s ${external('https://console.cloud.google.com/apis/api/routes.googleapis.com/quotas', 'Quotas')} page, cap requests per day (200 is plenty) so a mistake can’t run up a bill.</li>
            <li>Paste the key above. It stays in this browser and isn’t included in backups.</li>
          </ol>
        </details>
      </section>
      <section class="ed-section">
        <h3>Add a route</h3>
        <form class="tr-add" data-add>
          <label class="field"><span>Google Maps directions link</span><input class="input" name="link" autocomplete="off" spellcheck="false" placeholder="https://www.google.com/maps/dir/…" /></label>
          <p class="w-hint">Or type the addresses:</p>
          <div class="dm-two">
            <label class="field"><span>From</span><input class="input" name="origin" autocomplete="off" /></label>
            <label class="field"><span>To</span><input class="input" name="destination" autocomplete="off" /></label>
          </div>
          <label class="field"><span>Name</span><input class="input" name="name" autocomplete="off" placeholder="Work → Home" /></label>
          <p class="w-hint" data-via hidden></p>
          <p class="w-error" data-add-err hidden></p>
          <div><button type="submit" class="btn primary">Add route</button></div>
        </form>
      </section>
      <section class="ed-section">
        <h3>Refreshing</h3>
        <label class="field"><span>Check every</span>
          <select class="select" name="interval">${INTERVALS.map((m) => `<option value="${m}">${m} minutes</option>`).join('')}</select>
        </label>
        <label class="check small"><input type="checkbox" name="limit" /> Only between <input class="input small time" type="time" name="from" aria-label="From" /> and <input class="input small time" type="time" name="to" aria-label="To" /></label>
        <label class="check small"><input type="checkbox" name="weekdays" /> Weekdays only</label>
        <p class="w-hint" data-estimate></p>
      </section>
    </div>
    <div data-foot></div>`;
  const view = el.querySelector('[data-view]');
  const editor = el.querySelector('[data-editor]');
  const keyForm = el.querySelector('[data-key-form]');
  const keyState = el.querySelector('[data-key-state]');
  const addForm = el.querySelector('[data-add]');
  const addErr = el.querySelector('[data-add-err]');
  const viaEl = el.querySelector('[data-via]');
  const estimate = el.querySelector('[data-estimate]');
  const foot = el.querySelector('[data-foot]');

  const results = () => {
    const c = ctx.cache.get();
    return c.results && typeof c.results === 'object' ? c.results : {};
  };

  function draw() {
    const s = state();
    const res = results();
    const k = key();
    if (!k && !PREVIEW) {
      view.innerHTML = `<div class="callout"><p>Drive times come from Google, using your own Google Maps API key. Setting one up takes a few minutes.</p><button type="button" class="btn" data-setup>Set up</button></div>`;
    } else if (!s.routes.length) {
      view.innerHTML = `<p class="w-hint">Add a route with <strong>Edit</strong>. Pasting a Google Maps directions link is quickest.</p>`;
    } else if (editing) {
      view.innerHTML = `<ul class="edit-list">${s.routes
        .map(
          (r, i) => `<li><input class="input small" data-rename="${i}" value="${esc(r.name)}" aria-label="Name for ${esc(r.name)}" />
            <button type="button" class="btn small quiet" data-reverse="${i}" title="Add the same trip the other way">Add return</button>
            <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(r.name)}" title="Remove">${ICONS.close}</button></li>`,
        )
        .join('')}</ul>`;
    } else {
      view.innerHTML = s.routes
        .map((r) => {
          const x = res[r.id];
          const link = external(mapsLinkFor(r), esc(r.name), 'tr-name');
          if (!x || (!x.duration && !x.error && !x.none)) {
            return `<div class="tr-route"><div class="tr-top">${link}<span class="tr-eta faint">${busy ? '…' : '–'}</span></div><div class="tr-sub"><span>${busy ? 'Asking Google…' : 'Not checked yet'}</span></div></div>`;
          }
          if (x.none) return `<div class="tr-route"><div class="tr-top">${link}</div><p class="w-error">Google couldn’t find a driving route between these places.</p></div>`;
          const errLine = x.error ? `<p class="w-error">${esc(x.error.text)}</p>` : '';
          if (!x.duration) return `<div class="tr-route"><div class="tr-top">${link}</div>${errLine}</div>`;
          const lvl = trafficLevel(x.duration, x.typical);
          const extra = x.typical ? Math.round((x.duration - x.typical) / 60) : 0;
          const delay = extra >= 1 ? `+${extra} min traffic` : 'No delays';
          const fresh = Date.now() - x.okAt < 30 * 60e3;
          return `<div class="tr-route lvl-${lvl}">
            <div class="tr-top">${link}<span class="tr-eta">${esc(formatDuration(x.duration))}</span></div>
            <div class="tr-sub"><span>${esc([x.via ? `via ${x.via}` : '', formatDistance(x.distance, miles)].filter(Boolean).join(' · '))}</span><span class="tr-delay">${esc(delay)}</span></div>
            <div class="tr-sub faint"><span>${fresh ? `Leave now, arrive ${esc(clockTime(x.okAt + x.duration * 1000))}` : `As of ${esc(clockTime(x.okAt))}`}</span>${x.typical ? `<span>${esc(formatDuration(x.typical))} without traffic</span>` : ''}</div>
            ${errLine}
          </div>`;
        })
        .join('');
    }
    // Footer: when it last checked and when it will again.
    const c = ctx.cache.get();
    let line = '';
    if (busy) line = 'Asking Google…';
    else if (k && s.routes.length) {
      const now = new Date();
      const paused = !withinHours(now, s.hours);
      line = c.at ? `Updated ${esc(clockTime(c.at))}` : '';
      line += paused ? `${line ? ' · ' : ''}Paused until ${esc(s.hours.from)}${s.hours.weekdays ? ' on a weekday' : ''}` : `${line ? ' · ' : ''}every ${s.interval} min`;
    }
    foot.innerHTML = (k || PREVIEW) && s.routes.length ? liveFoot(line, '<span class="faint">Google Maps</span>') : '';

    // Editor bits that depend on settings.
    if (editing) {
      keyState.textContent = k ? `A key ending in …${k.slice(-4)} is saved in this browser.` : 'No key yet.';
      const f = editor.querySelector('[name="interval"]');
      if (document.activeElement !== f) f.value = String(s.interval);
      const lim = editor.querySelector('[name="limit"]');
      lim.checked = s.hours.limit;
      const from = editor.querySelector('[name="from"]');
      const to = editor.querySelector('[name="to"]');
      if (document.activeElement !== from) from.value = s.hours.from;
      if (document.activeElement !== to) to.value = s.hours.to;
      from.disabled = to.disabled = !s.hours.limit;
      const wk = editor.querySelector('[name="weekdays"]');
      wk.checked = s.hours.weekdays;
      wk.disabled = !s.hours.limit;
      const n = monthlyEstimate({ routes: Math.max(1, s.routes.length), interval: s.interval, hours: s.hours });
      estimate.textContent = `At most about ${num(n)} requests a month for ${s.routes.length || 1} route${s.routes.length > 1 ? 's' : ''}, counting only while Shelfmark is open. ${num(FREE_PER_MONTH)} a month are free.`;
      estimate.classList.toggle('w-error', n > FREE_PER_MONTH);
    }
  }

  async function checkRoute(r, k) {
    const prev = results()[r.id] || {};
    try {
      const { url, init } = routesRequest(r, k, { miles });
      let res;
      try {
        res = await request(url, init);
      } catch (err) {
        if (err instanceof NetError && err.kind === 'http') return { ...prev, at: Date.now(), error: { kind: 'http', text: routesError(err.status, err.body) } };
        throw err;
      }
      const out = parseRoutes(await res.json());
      if (!out) return { at: Date.now(), none: true };
      return { at: Date.now(), okAt: Date.now(), ...out };
    } catch (err) {
      return { ...prev, at: Date.now(), error: errInfo(err instanceof NetError ? err : null, 'Google') };
    }
  }

  async function check(force = false) {
    const s = state();
    const k = key();
    if (!k || !s.routes.length || busy || PREVIEW) return;
    const c = ctx.cache.get();
    const res = results();
    const missing = s.routes.some((r) => !res[r.id]);
    if (!force) {
      if (!withinHours(new Date(), s.hours) && !missing) return;
      if (!missing && Date.now() - (c.at || 0) < s.interval * 60e3) return;
      if (c.failAt && Date.now() - c.failAt < 2 * 60e3) return;
    }
    busy = true;
    draw();
    try {
      const out = await Promise.all(s.routes.map((r) => checkRoute(r, k)));
      const next = {};
      s.routes.forEach((r, i) => (next[r.id] = out[i]));
      const failed = out.every((x) => x.error);
      await ctx.cache.set({ at: Date.now(), results: next, failAt: failed ? Date.now() : 0 });
    } finally {
      busy = false;
      draw();
    }
  }

  function setEditing(on) {
    editing = on;
    editor.hidden = !on;
    editBtn.textContent = on ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(on));
    addErr.hidden = true;
    draw();
    if (on) (key() ? addForm.elements.link : keyForm.elements.key).focus();
    else check();
  }
  editBtn.addEventListener('click', () => setEditing(!editing));

  keyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = keyForm.elements.key.value.trim();
    if (!v) return;
    await ctx.secret.set('googleKey', v);
    keyForm.elements.key.value = '';
    await ctx.cache.set({}); // results from another key don't count
    draw();
    addForm.elements.link.focus();
  });

  addForm.elements.link.addEventListener('input', () => {
    const v = addForm.elements.link.value.trim();
    addErr.hidden = true;
    viaEl.hidden = true;
    if (!v) return;
    const p = parseMapsLink(v);
    if (p.error) {
      addErr.textContent = p.error;
      addErr.hidden = false;
      return;
    }
    addForm.elements.origin.value = p.origin;
    addForm.elements.destination.value = p.destination;
    if (!addForm.elements.name.value) addForm.elements.name.placeholder = defaultName(p.origin, p.destination);
    if (p.via.length) {
      viaEl.textContent = `Through ${p.via.length} stop${p.via.length > 1 ? 's' : ''}: ${p.via.join('; ')}`;
      viaEl.hidden = false;
    }
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = addForm.elements;
    const origin = f.origin.value.trim();
    const destination = f.destination.value.trim();
    let via = [];
    let link = '';
    const p = f.link.value.trim() ? parseMapsLink(f.link.value) : null;
    if (p && !p.error && p.origin === origin && p.destination === destination) {
      via = p.via;
      link = p.link;
    }
    if (!origin || !destination) {
      addErr.textContent = 'Paste a directions link, or fill in From and To.';
      addErr.hidden = false;
      return;
    }
    const s = state();
    const route = { id: uid('r'), name: f.name.value.trim() || defaultName(origin, destination), origin, destination, via, link };
    await save({ routes: [...s.routes, route] });
    addForm.reset();
    addForm.elements.name.placeholder = 'Work → Home';
    viaEl.hidden = true;
    addErr.hidden = true;
    draw();
    check();
    f.link.focus();
  });

  editor.addEventListener('change', async (e) => {
    const t = e.target;
    const s = state();
    if (t.name === 'interval') await save({ interval: Number(t.value) });
    if (t.name === 'limit') await save({ hours: { ...s.hours, limit: t.checked } });
    if (t.name === 'weekdays') await save({ hours: { ...s.hours, weekdays: t.checked } });
    if ((t.name === 'from' || t.name === 'to') && /^\d{2}:\d{2}$/.test(t.value)) await save({ hours: { ...s.hours, [t.name]: t.value } });
    if (['interval', 'limit', 'weekdays', 'from', 'to'].includes(t.name)) draw();
  });

  view.addEventListener('click', async (e) => {
    if (e.target.closest('[data-setup]')) return setEditing(true);
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const routes = state().routes;
      routes.splice(Number(rm.dataset.remove), 1);
      await save({ routes });
      draw();
      return;
    }
    const rv = e.target.closest('[data-reverse]');
    if (rv) {
      const s = state();
      const r = s.routes[Number(rv.dataset.reverse)];
      if (!r) return;
      const back = { id: uid('r'), name: defaultName(r.destination, r.origin), origin: r.destination, destination: r.origin, via: [...(r.via || [])].reverse(), link: '' };
      if (/→/.test(r.name)) back.name = r.name.split('→').map((x) => x.trim()).reverse().join(' → ');
      await save({ routes: [...s.routes, back] });
      draw();
    }
  });
  view.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-rename]');
    if (!inp) return;
    const routes = state().routes;
    const r = routes[Number(inp.dataset.rename)];
    if (!r || !inp.value.trim()) return;
    r.name = inp.value.trim();
    await save({ routes });
  });
  foot.addEventListener('click', (e) => {
    if (e.target.closest('[data-refresh]')) check(true);
  });

  draw();
  let lastMinute = -1;
  return {
    tick(now, full) {
      if (full || now.getMinutes() !== lastMinute) {
        lastMinute = now.getMinutes();
        if (!(editing && el.contains(document.activeElement))) draw(); // keeps "arrive" times and the paused line current
      }
      if (!editing) check();
    },
    refresh() {
      if (editing && el.contains(document.activeElement)) return;
      draw();
    },
  };
}

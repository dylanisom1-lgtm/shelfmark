// Toolbar popup: save the current page, or every tab in this window.

import { MODES, MODE_ORDER, nextColor, groupDefaults, groupOf, newGroup, newBookmark, findByUrl, fallbackTitle, isValidUrl } from '../lib/model.js';
import { loadDoc, mutate } from '../lib/store.js';
import { openAppTab } from '../lib/open.js';
import { ext } from '../lib/browser.js';

const $ = (s) => document.querySelector(s);
const form = $('#save-form');
const f = form.elements;
const LAST_GROUP_KEY = 'shelfmark.popup.lastGroup';

let doc;
let tab;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function applyTheme() {
  const t = doc.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function refreshModeLabel() {
  const gid = f.group.value;
  const g = gid && gid !== '__new' ? doc.groups.find((x) => x.id === gid) : null;
  const gd = groupDefaults(doc, g);
  const keep = f.mode.value;
  f.mode.innerHTML =
    `<option value="">${g ? 'Group setting' : 'Default'} (${esc(MODES[gd.mode].label)})</option>` +
    MODE_ORDER.map((m) => `<option value="${m}">${esc(MODES[m].label)}</option>`).join('');
  f.mode.value = keep;
  $('#new-group-field').hidden = gid !== '__new';
}

function showError(msg) {
  const el = $('#error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function done(text) {
  form.hidden = true;
  $('#done').hidden = false;
  $('#done-text').textContent = text;
  $('#done-open').focus();
}

async function init() {
  doc = await loadDoc();
  applyTheme();
  [tab] = await ext.tabs.query({ active: true, currentWindow: true });

  const url = tab && tab.url ? tab.url : '';
  f.title.value = (tab && tab.title) || fallbackTitle(url);
  $('#url').textContent = url;
  $('#url').title = url;

  const stored = await ext.storage.local.get(LAST_GROUP_KEY);
  const last = stored[LAST_GROUP_KEY];
  f.group.innerHTML =
    doc.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('') + '<option value="__new">New group…</option>';
  f.group.value = doc.groups.some((g) => g.id === last) ? last : doc.groups[0] ? doc.groups[0].id : '__new';
  if (!doc.groups.length) f.newGroup.value = 'Bookmarks';
  refreshModeLabel();

  const existing = url ? findByUrl(doc, url) : null;
  if (existing) {
    const g = groupOf(doc, existing.id);
    const note = $('#saved-note');
    note.innerHTML = `Already saved${g ? ` in “${esc(g.name)}”` : ''}. <button type="button" id="edit-existing">Edit it</button>`;
    note.hidden = false;
    $('#edit-existing').addEventListener('click', () => openAppTab({ edit: existing.id }).then(() => window.close()));
    $('#save-btn').textContent = 'Save another copy';
  }

  if (!url || !isValidUrl(url)) {
    $('#save-btn').disabled = true;
    showError("This page can't be saved.");
  }

  const tabs = await ext.tabs.query({ currentWindow: true });
  const savable = tabs.filter((t) => t.url && isValidUrl(t.url) && !t.url.startsWith(ext.runtime.getURL('')));
  const all = $('#save-all');
  all.textContent = `Save all ${savable.length} tab${savable.length === 1 ? '' : 's'} in this window as a new group`;
  all.disabled = savable.length === 0;
  all.addEventListener('click', () => saveAll(savable));

  f.title.focus();
  f.title.select();
}

f.group.addEventListener('change', refreshModeLabel);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const gid = f.group.value;
  const newName = f.newGroup.value.trim();
  if (gid === '__new' && !newName) {
    showError('Name the new group.');
    f.newGroup.focus();
    return;
  }
  const url = tab.url;
  const title = f.title.value.trim() || fallbackTitle(url);
  const mode = f.mode.value || null;
  let groupName = '';
  let groupId = gid;
  await mutate((d) => {
    let target;
    if (gid === '__new') {
      target = newGroup(newName, nextColor(d));
      d.groups.push(target);
    } else {
      target = d.groups.find((g) => g.id === gid);
    }
    if (!target) return;
    const bm = newBookmark({ url, title, mode });
    d.bookmarks[bm.id] = bm;
    target.items.push(bm.id);
    groupName = target.name;
    groupId = target.id;
  });
  await ext.storage.local.set({ [LAST_GROUP_KEY]: groupId });
  done(`Saved to “${groupName}”.`);
  setTimeout(() => window.close(), 900);
});

async function saveAll(tabs) {
  const d = new Date();
  const name = `Tabs from ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  let count = 0;
  await mutate((doc) => {
    const g = newGroup(name, nextColor(doc));
    for (const t of tabs) {
      const bm = newBookmark({ url: t.url, title: t.title || fallbackTitle(t.url) });
      doc.bookmarks[bm.id] = bm;
      g.items.push(bm.id);
      count++;
    }
    doc.groups.push(g);
  });
  $('#save-all').disabled = true;
  done(`Saved ${count} tab${count === 1 ? '' : 's'} to a new group, “${name}”. Rename it in Shelfmark.`);
}

$('#open-app').addEventListener('click', () => openAppTab().then(() => window.close()));
$('#done-open').addEventListener('click', () => openAppTab().then(() => window.close()));

init();

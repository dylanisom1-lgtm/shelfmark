// First-run setup: layout, start-up and private windows, then bookmarks.
// Progress is saved after every step, because changing the private-window setting
// can make the browser reload the extension and close this tab.

import { getKey, setKey, IS_EXTENSION } from '../lib/store.js';
import { incognitoAllowed } from '../lib/open.js';
import { B, lowerFirst, canOpenExtensionSettings, openExtensionSettings } from '../lib/browser.js';
import { layoutPickerHtml } from './views.js';

const STEP_KEY = 'shelfmark.setupStep';
const STEPS = 3;

export function createSetup({ getDoc, commit, openImportDialog, onDone }) {
  const el = document.getElementById('setup');
  const q = (s) => el.querySelector(s);
  let step = 1;
  let visible = false;

  q('[data-setup-layouts]').addEventListener('change', (e) => {
    if (e.target.name === 'setup-layout') markPicked();
  });

  function markPicked() {
    el.querySelectorAll('.lp-card').forEach((c) => c.classList.toggle('picked', c.querySelector('input').checked));
  }

  async function paint() {
    const doc = getDoc();
    el.querySelectorAll('[data-step]').forEach((s) => (s.hidden = Number(s.dataset.step) !== step));
    q('[data-step-label]').textContent = `Step ${step} of ${STEPS}`;
    q('[data-setup="back"]').hidden = step === 1;
    const next = q('[data-setup="next"]');
    next.textContent = step === STEPS ? 'Finish' : 'Continue';

    if (step === 1) {
      q('[data-setup-layouts]').innerHTML = layoutPickerHtml(doc.settings.layout, 'setup-layout');
      markPicked();
    }
    if (step === 2) {
      el.querySelectorAll('input[name="setup-startup"]').forEach((r) => (r.checked = String(doc.settings.openOnStartup) === r.value));
      const status = q('[data-setup-incog]');
      if (!IS_EXTENSION) {
        status.textContent = 'Once Shelfmark is installed, this shows whether private-window bookmarks can open.';
        q('[data-setup-incog-btn]').hidden = true;
      } else if (await incognitoAllowed()) {
        status.innerHTML = '<strong>Turned on.</strong> Private-window bookmarks open directly.';
        q('[data-setup-incog-btn]').hidden = true;
      } else {
        status.innerHTML = canOpenExtensionSettings
          ? `Bookmarks set to open in a private window need <strong>${B.privateSetting}</strong> turned on for Shelfmark. Skip this if you won’t use private windows.`
          : `Bookmarks set to open in a private window need one ${B.name} setting. ${B.settingsHow.replace(B.privateSetting, `<strong>${B.privateSetting}</strong>`)}. Skip this if you won’t use private windows.`;
        q('[data-setup-incog-btn]').hidden = !canOpenExtensionSettings;
      }
    }
    if (step === 3) {
      const n = Object.keys(doc.bookmarks).length;
      q('[data-setup-have]').textContent = n
        ? `You already have ${n} bookmark${n === 1 ? '' : 's'} here. Import more, or finish and keep what you have.`
        : 'Bring in the bookmarks you already have, or start empty and add them as you go.';
      q('[data-finish-label]').textContent = n ? 'Keep what’s here' : 'Start empty';
    }
    const focusTarget = step === 1 ? el.querySelector('input[name="setup-layout"]:checked') : next;
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  async function go(n) {
    step = Math.max(1, Math.min(STEPS, n));
    await setKey(STEP_KEY, step);
    await paint();
    window.scrollTo(0, 0);
  }

  async function saveCurrent() {
    if (step === 1) {
      const picked = el.querySelector('input[name="setup-layout"]:checked');
      if (picked) await commit((doc) => (doc.settings.layout = picked.value), { quiet: true });
    }
    if (step === 2) {
      const picked = el.querySelector('input[name="setup-startup"]:checked');
      if (picked) await commit((doc) => (doc.settings.openOnStartup = picked.value === 'true'), { quiet: true });
    }
  }

  async function finish() {
    await saveCurrent();
    await setKey(STEP_KEY, 1);
    hide();
    await commit((doc) => (doc.settings.setupDone = true));
    onDone();
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-setup]');
    if (!b) return;
    const what = b.dataset.setup;
    if (what === 'next') {
      if (step === STEPS) return finish();
      await saveCurrent();
      return go(step + 1);
    }
    if (what === 'back') return go(step - 1);
    if (what === 'import') return openImportDialog();
    if (what === 'finish') return finish();
    if (what === 'incognito') return openExtensionSettings();
  });

  // An import finished during step 3 completes setup.
  document.addEventListener('shelfmark:imported', () => {
    if (visible && step === STEPS) finish();
  });

  // Returning from the browser's extension page: refresh the private-window status.
  window.addEventListener('focus', () => {
    if (visible && step === 2) paint();
  });

  async function show() {
    if (visible) return;
    visible = true;
    document.body.classList.add('in-setup');
    el.hidden = false;
    step = Number(await getKey(STEP_KEY)) || 1;
    await paint();
  }

  function hide() {
    visible = false;
    el.hidden = true;
    document.body.classList.remove('in-setup');
  }

  async function restart() {
    await setKey(STEP_KEY, 1);
    await commit((doc) => (doc.settings.setupDone = false));
  }

  return { show, hide, restart, get visible() { return visible; } };
}

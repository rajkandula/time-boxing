// Entry point: wires state, timer and rendering to the page.
import * as S from './store.js';
import * as T from './timer.js';
import { renderPlan, renderFocus, renderReview, updateClock, dayLabel } from './render.js';
import { $, $$, hydrateIcons, icon, toast, announce, openDialog, closeDialog, enableBackdropClose, confirmDialog, download } from './ui.js';
import { unlockAudio, chime, vibrate, notify, requestNotifications, notificationsSupported, keepAwake } from './alerts.js';
import { dateKey, addDays, parseQuickAdd, minutesToHHMM, minutesOfDay, roundUpTo, isHHMM, formatDuration, clamp } from './core.js';

const VIEWS = ['plan', 'focus', 'review'];
const ui = { view: 'plan', today: dateKey(), dayKey: dateKey(), editing: null };
const settings = () => S.store.state.settings;
const timer = () => S.store.state.timer;

/* ---------- rendering ---------- */

function render() {
  if (ui.view === 'plan') renderPlan(ui);
  if (ui.view === 'review') renderReview(ui);
  renderFocus(ui); // the header badge and mini timer depend on it from every view
  syncWakeLock();
}

function setView(view, { focus = false } = {}) {
  if (!VIEWS.includes(view)) return;
  ui.view = view;
  for (const v of VIEWS) {
    const tab = $(`#tab-${v}`);
    const selected = v === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#view-${v}`).hidden = !selected;
  }
  if (focus) $(`#tab-${view}`).focus();
  try { localStorage.setItem('timebox:view', view); } catch { /* ignore */ }
  render();
}

function setDay(key) {
  ui.dayKey = key;
  render();
}

function applyTheme() {
  const theme = settings().theme;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = $('#btn-theme');
  btn.replaceChildren(icon({ system: 'monitor', light: 'sun', dark: 'moon' }[theme]));
  btn.setAttribute('aria-label', `Theme: ${theme}. Click to change.`);
  btn.title = `Theme: ${theme}`;
}

let awake = false;
function syncWakeLock() {
  const want = settings().keepAwake && timer().running;
  if (want !== awake || (want && document.visibilityState === 'visible')) {
    awake = want;
    keepAwake(want);
  }
}

/* ---------- timer events ---------- */

function alertUser(kind, title, body) {
  if (settings().sound) chime(kind, settings().volume);
  vibrate();
  announce(`${title}. ${body}`);
  if (settings().notifications && document.visibilityState !== 'visible') notify(title, body);
}

function openOutcome({ early = false } = {}) {
  const t = timer();
  const box = t.phase === 'focus' ? S.findBox(t.dayKey, t.boxId) : null;
  if (!box) return;
  const dlg = $('#dlg-outcome');
  $('#outcome-title').textContent = early ? 'Finish this box?' : "Time's up!";
  $('#outcome-box').textContent = box.goal ? `${box.title} · Goal: ${box.goal}` : box.title;
  $('#outcome-form').reset();
  $('#outcome-note').value = box.note || '';
  $('#outcome-extend').hidden = early;
  const br = settings().autoStartBreaks && (settings().shortBreakMinutes > 0 || settings().longBreakMinutes > 0);
  $('#outcome-save').textContent = br ? 'Save & take a break' : 'Save';
  dlg.dataset.early = early ? '1' : '';
  dlg.returnValue = ''; // Esc leaves the previous value in place
  openDialog(dlg);
}

const hooks = {
  onTick: () => updateClock(ui),
  onExternal: render,
  onPhaseStart: () => {
    if (ui.view !== 'focus' && window.matchMedia('(max-width: 720px)').matches) setView('focus');
  },
  onFocusTimeUp: (box, { away }) => {
    if (!away) alertUser('focus', "Time's up", box ? `“${box.title}” is done. How did it go?` : 'Your focus box is done.');
    render();
    openOutcome();
  },
  onBreakEnd: ({ away, natural }) => {
    const next = T.nextBox(ui.today);
    if (natural && !away) alertUser('break', 'Break over', next ? `Next up: ${next.title}` : 'Ready for another box?');
    if (natural && !away && settings().autoStartNext && next) T.startFocus(ui.today, next.id);
    render();
  },
};

/* ---------- actions ---------- */

function startBox(id) {
  unlockAudio();
  T.startFocus(ui.today, id);
}

function quickBox(title, minutes) {
  unlockAudio();
  const parsed = parseQuickAdd(title);
  const box = S.addBox(ui.today, {
    title: parsed.title || 'Focus session',
    subject: parsed.subject,
    minutes: minutes || parsed.minutes || settings().focusMinutes,
  });
  T.startFocus(ui.today, box.id);
  setView('focus');
}

function mainAction(action) {
  unlockAudio();
  const next = T.nextBox(ui.today);
  switch (action) {
    case 'start-next': if (next) startBox(next.id); break;
    case 'quick': quickBox('', settings().focusMinutes); break;
    case 'start-break': T.startSuggestedBreak(); break;
    case 'pause': T.pause(); break;
    case 'resume': T.resume(); break;
    case 'finish': openOutcome(); break;
  }
}

function toggleTimer() {
  const t = timer();
  if (t.ended) openOutcome();
  else if (t.phase === 'idle') mainAction($('#ctl-main').dataset.action);
  else T.toggle();
}

function stopTimer() {
  const t = timer();
  if (t.phase === 'idle') {
    T.stop();
    return;
  }
  const secs = T.stop();
  toast(t.phase === 'focus' ? `Stopped. ${formatDuration(secs / 60)} logged; resume any time.` : 'Break ended.');
}

function finishTimer() {
  const t = timer();
  if (t.phase !== 'focus') return;
  if (t.running) T.pause();
  openOutcome({ early: !t.ended });
}

function skipTimer() {
  const t = timer();
  if (t.phase === 'focus') {
    const box = S.findBox(t.dayKey, t.boxId);
    T.skipFocus();
    if (box) toast(`Skipped “${box.title}”.`);
  } else {
    T.skipBreak();
  }
}

function addDumpItem(text) {
  const parsed = parseQuickAdd(text);
  const title = parsed.title || (parsed.subject ? `${parsed.subject} study` : '');
  if (!title) return false;
  S.addInbox({ title, subject: parsed.subject, minutes: parsed.minutes });
  return true;
}

function openEdit(id) {
  const box = S.findBox(ui.dayKey, id);
  if (!box) return;
  ui.editing = { dayKey: ui.dayKey, id };
  $('#edit-name').value = box.title;
  $('#edit-subject').value = box.subject;
  $('#edit-minutes').value = box.minutes;
  $('#edit-goal').value = box.goal;
  $('#edit-status').value = box.status;
  openDialog($('#dlg-edit'));
}

/* ---------- settings dialog ---------- */

function fillSettings() {
  const s = settings();
  const form = $('#settings-form');
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.name === 'dailyGoalHours') input.value = String(s.dailyGoalMinutes / 60);
    else if (input.type === 'checkbox') input.checked = !!s[input.name];
    else if (input.type === 'radio') input.checked = s[input.name] === input.value;
    else if (input.name in s) input.value = String(s[input.name]);
  }
  updateNotifNote();
  updateStorageNote();
}

function updateNotifNote() {
  const note = $('#notif-note');
  if (!notificationsSupported()) note.textContent = 'This browser does not support system notifications.';
  else if (Notification.permission === 'denied') note.textContent = 'Notifications are blocked for this site. Allow them in your browser settings.';
  else note.textContent = 'Shown only while Timebox is in the background.';
}

async function updateStorageNote() {
  const note = $('#storage-note');
  if (!S.store.storageOk) {
    note.textContent = 'Saving is not available in this browser mode (for example a private window). Your plans will be lost when you close this tab.';
    return;
  }
  const persisted = await S.storagePersisted();
  note.replaceChildren();
  if (persisted === false) {
    note.append('Your browser may clear site data when space runs low. ');
    note.append(Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn btn-sm btn-soft', textContent: 'Protect my data',
      onclick: async () => {
        const ok = await S.requestPersist();
        toast(ok ? 'Storage is now protected.' : 'The browser declined. Exporting a backup now and then is a good idea.');
        updateStorageNote();
      },
    }));
  } else if (persisted) {
    note.textContent = 'Storage is protected from automatic cleanup.';
  }
}

function readSetting(input) {
  const s = settings();
  const n = (min, max) => clamp(Math.round(Number(input.value) || 0), min, max);
  switch (input.name) {
    case 'focusMinutes': return { focusMinutes: n(1, 240) };
    case 'shortBreakMinutes': return { shortBreakMinutes: n(0, 60) };
    case 'longBreakMinutes': return { longBreakMinutes: n(0, 120) };
    case 'longBreakEvery': return { longBreakEvery: n(0, 12) };
    case 'dailyGoalHours': return { dailyGoalMinutes: clamp(Math.round((Number(input.value) || 0) * 60), 0, 1440) };
    case 'dayStart': return isHHMM(input.value) ? { dayStart: input.value } : null;
    case 'volume': return { volume: clamp(Number(input.value), 0, 1) };
    case 'theme': return input.checked ? { theme: input.value } : null;
    default: return input.type === 'checkbox' && input.name in s ? { [input.name]: input.checked } : null;
  }
}

/* ---------- drag to reorder ---------- */

function enableSorting(list) {
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button > 0) return;
    const item = handle.closest('.box');
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let moved = false;
    list.classList.add('sorting');
    item.classList.add('dragging');
    const grabOffset = e.clientY - item.getBoundingClientRect().top;

    const onMove = (ev) => {
      moved = moved || Math.abs(ev.clientY - startY) > 3;
      if (ev.clientY < 70) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
      const before = $$('.box:not(.dragging)', list).find((s) => {
        const r = s.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (before) {
        if (item.nextElementSibling !== before) list.insertBefore(item, before);
      } else if (list.lastElementChild !== item) {
        list.append(item);
      }
      // Keep the card under the pointer wherever it now sits in the list.
      item.style.transform = '';
      const layoutTop = item.getBoundingClientRect().top;
      item.style.transform = `translateY(${ev.clientY - grabOffset - layoutTop}px)`;
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      item.style.transform = '';
      item.classList.remove('dragging');
      list.classList.remove('sorting');
      if (moved) S.reorderBoxes(ui.dayKey, $$('.box', list).map((b) => b.dataset.id));
      else render();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = handle.closest('.box').dataset.id;
    if (S.moveBox(ui.dayKey, id, e.key === 'ArrowUp' ? -1 : 1)) {
      list.querySelector(`.box[data-id="${CSS.escape(id)}"] .drag-handle`)?.focus();
      announce('Moved.');
    }
  });
}

/* ---------- wiring ---------- */

function bindPlan() {
  $('#day-prev').addEventListener('click', () => setDay(addDays(ui.dayKey, -1)));
  $('#day-next').addEventListener('click', () => setDay(addDays(ui.dayKey, 1)));
  $('#day-today').addEventListener('click', () => setDay(ui.today));
  $('#btn-carry').addEventListener('click', (e) => {
    const n = S.carryOver(e.currentTarget.dataset.from, ui.today);
    if (n) toast(`Moved ${n} unfinished ${n === 1 ? 'box' : 'boxes'} to today.`);
  });

  $('#dump-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#dump-input');
    if (addDumpItem(input.value)) input.value = '';
    input.focus();
  });

  const onTaskClick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('.task').dataset.id;
    if (btn.dataset.action === 'star') {
      if (!S.toggleStar(id)) toast('Keep it to your top 3. Unstar one first.');
    } else if (btn.dataset.action === 'box') {
      const box = S.inboxToBox(id, ui.dayKey);
      if (box) toast(`Boxed “${box.title}” into ${dayLabel(ui.dayKey, ui.today).toLowerCase() === 'today' ? 'today' : dayLabel(ui.dayKey, ui.today)}.`);
    } else if (btn.dataset.action === 'delete') {
      const removed = S.removeInbox(id);
      if (removed) toast('Task deleted.', { action: 'Undo', onAction: () => S.restoreInbox(removed.item, removed.index) });
    }
  };
  $('#priority-list').addEventListener('click', onTaskClick);
  $('#dump-list').addEventListener('click', onTaskClick);

  $('#day-start').addEventListener('change', (e) => {
    if (isHHMM(e.target.value)) S.setDayStart(ui.dayKey, e.target.value);
  });
  $('#btn-start-now').addEventListener('click', () => {
    S.setDayStart(ui.dayKey, minutesToHHMM(roundUpTo(minutesOfDay(), 5)));
  });

  const list = $('#box-list');
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('.box').dataset.id;
    if (btn.dataset.action === 'start') {
      startBox(id);
      setView('focus');
    } else if (btn.dataset.action === 'edit') {
      openEdit(id);
    }
  });
  enableSorting(list);

  const chips = $('#duration-chips');
  const minutes = $('#box-minutes');
  const syncChips = () => {
    for (const chip of $$('.chip', chips)) chip.setAttribute('aria-checked', String(chip.dataset.min === minutes.value));
  };
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    minutes.value = chip.dataset.min;
    syncChips();
  });
  minutes.addEventListener('input', syncChips);
  minutes.value = String(settings().focusMinutes);
  syncChips();

  $('#box-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const titleInput = $('#box-title');
    const parsed = parseQuickAdd(titleInput.value);
    const title = parsed.title || (parsed.subject ? `${parsed.subject} study` : '');
    if (!title) return;
    S.addBox(ui.dayKey, {
      title,
      subject: $('#box-subject').value.trim() || parsed.subject,
      minutes: parsed.minutes || clamp(Math.round(Number(minutes.value)) || settings().focusMinutes, 1, 480),
    });
    titleInput.value = '';
    titleInput.focus();
  });
}

function bindFocus() {
  $('#ctl-main').addEventListener('click', (e) => mainAction(e.currentTarget.dataset.action));
  $('#ctl-stop').addEventListener('click', stopTimer);
  $('#ctl-extend').addEventListener('click', () => {
    T.extend(5);
    toast('Added 5 minutes.');
  });
  $('#ctl-finish').addEventListener('click', finishTimer);
  $('#ctl-skip').addEventListener('click', skipTimer);
  $('#upnext-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="start-box"]');
    if (btn) startBox(btn.closest('li').dataset.id);
  });
  $('#quick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mins = Number(e.submitter?.dataset.min) || settings().focusMinutes;
    quickBox($('#quick-title').value, mins);
    $('#quick-title').value = '';
  });
  $('#mini-timer').addEventListener('click', () => setView('focus'));
}

function bindDialogs() {
  for (const dlg of $$('dialog')) {
    enableBackdropClose(dlg);
    for (const btn of $$('[data-close]', dlg)) btn.addEventListener('click', () => closeDialog(dlg));
  }

  // Outcome
  $('#outcome-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const outcome = new FormData(e.currentTarget).get('outcome');
    T.completeFocus(outcome, $('#outcome-note').value.trim());
    closeDialog($('#dlg-outcome'), 'saved');
    const t = timer();
    toast(t.phase === 'short' || t.phase === 'long' ? 'Logged. Enjoy your break!' : 'Logged. Nice work!');
  });
  $('#outcome-extend').addEventListener('click', () => {
    T.extend(5);
    closeDialog($('#dlg-outcome'), 'extend');
  });
  $('#dlg-outcome').addEventListener('close', (e) => {
    // Closing an early-finish dialog without saving resumes the paused box.
    const dlg = e.currentTarget;
    if (dlg.returnValue !== 'saved' && dlg.dataset.early && timer().phase === 'focus' && !timer().running) T.resume();
  });

  // Edit box
  $('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const { dayKey, id } = ui.editing || {};
    const title = $('#edit-name').value.trim();
    if (!id || !title) return;
    const status = $('#edit-status').value;
    const box = S.findBox(dayKey, id);
    const t = timer();
    if (box && status !== 'todo' && t.phase === 'focus' && t.boxId === id) T.stop();
    S.updateBox(dayKey, id, {
      title,
      subject: $('#edit-subject').value.trim().slice(0, 40),
      minutes: clamp(Math.round(Number($('#edit-minutes').value)) || 25, 1, 480),
      goal: $('#edit-goal').value.trim().slice(0, 300),
      status,
      outcome: status === 'done' ? box?.outcome ?? null : null,
      endedAt: status === 'todo' ? null : box?.endedAt || Date.now(),
    });
    closeDialog($('#dlg-edit'));
  });
  $('#edit-delete').addEventListener('click', () => {
    const { dayKey, id } = ui.editing || {};
    const removed = S.removeBox(dayKey, id);
    closeDialog($('#dlg-edit'));
    if (removed) toast('Time box deleted.', { action: 'Undo', onAction: () => S.restoreBox(dayKey, removed.box, removed.index) });
  });
  $('#edit-to-dump').addEventListener('click', () => {
    const { dayKey, id } = ui.editing || {};
    if (S.boxToInbox(dayKey, id)) toast('Moved back to your brain dump.');
    closeDialog($('#dlg-edit'));
  });

  // Settings: changes apply immediately.
  const form = $('#settings-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input.name) return;
    if (input.name === 'notifications' && input.checked) {
      const permission = await requestNotifications();
      if (permission !== 'granted') {
        input.checked = false;
        updateNotifNote();
        toast(permission === 'unsupported' ? 'Notifications are not supported here.' : 'Notifications were not allowed.');
        return;
      }
    }
    const patch = readSetting(input);
    if (patch) S.updateSettings(patch);
    if (input.type === 'number') fillSettings();
  });
  form.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-preset]');
    if (!preset) return;
    const [focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery] = preset.dataset.preset.split(',').map(Number);
    S.updateSettings({ focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery });
    $('#box-minutes').value = String(focusMinutes);
    $('#box-minutes').dispatchEvent(new Event('input'));
    fillSettings();
    toast(`Timer set to ${focusMinutes} / ${shortBreakMinutes}.`);
  });
  $('#btn-test-sound').addEventListener('click', () => {
    unlockAudio();
    chime('focus', settings().volume);
  });
  $('#btn-export').addEventListener('click', () => {
    download(`timebox-backup-${dateKey()}.json`, S.exportJSON());
    toast('Backup downloaded.');
  });
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const ok = await confirmDialog('Importing replaces everything currently saved in this browser.', {
        title: 'Import this backup?', confirmText: 'Replace my data', danger: true,
      });
      if (!ok) return;
      S.importJSON(text);
      fillSettings();
      toast('Backup imported.');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message || 'Import failed.');
    }
  });
  $('#btn-clear').addEventListener('click', async () => {
    const ok = await confirmDialog('This deletes your brain dump, every time box, your history and your settings from this device. It cannot be undone. Export a backup first if you might want it later.', {
      title: 'Clear all data?', confirmText: 'Delete everything', danger: true,
    });
    if (!ok) return;
    S.clearAll();
    T.stop();
    fillSettings();
    toast('All data cleared.');
  });
}

function bindGlobal() {
  $('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) setView(tab.dataset.view);
  });
  $('.tabs').addEventListener('keydown', (e) => {
    const i = VIEWS.indexOf(ui.view);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setView(VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length], { focus: true });
    }
  });
  $('#btn-theme').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    S.updateSettings({ theme: order[(order.indexOf(settings().theme) + 1) % order.length] });
  });
  $('#btn-help').addEventListener('click', () => openDialog($('#dlg-help')));
  $('#btn-settings').addEventListener('click', () => {
    fillSettings();
    openDialog($('#dlg-settings'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const target = e.target instanceof Element ? e.target : document.body;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key;
    if (key === ' ' && !target.closest('button, a')) {
      e.preventDefault();
      toggleTimer();
    } else if (key === '1' || key === '2' || key === '3') setView(VIEWS[Number(key) - 1]);
    else if (key === 'n' || key === 'N') {
      e.preventDefault();
      setView('plan');
      $('#dump-input').focus();
    } else if (key === 'b' || key === 'B') {
      e.preventDefault();
      setView('plan');
      $('#box-title').focus();
    } else if (key === 'f' || key === 'F') finishTimer();
    else if (key === 'e' || key === 'E') { if (timer().phase !== 'idle') { T.extend(5); toast('Added 5 minutes.'); } }
    else if (key === 's' || key === 'S') skipTimer();
    else if (key === 'ArrowLeft' && ui.view !== 'focus' && !target.closest('[role="tab"]')) setDay(addDays(ui.dayKey, -1));
    else if (key === 'ArrowRight' && ui.view !== 'focus' && !target.closest('[role="tab"]')) setDay(addDays(ui.dayKey, 1));
    else if (key === '?') openDialog($('#dlg-help'));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkDayRollover();
      awake = false;
      syncWakeLock();
    }
  });
  setInterval(checkDayRollover, 30000);
}

function checkDayRollover() {
  const now = dateKey();
  if (now === ui.today) return;
  const wasToday = ui.dayKey === ui.today;
  ui.today = now;
  if (wasToday) ui.dayKey = now;
  render();
}

/* ---------- install & offline ---------- */

function setupPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
    });
  }
  let deferred = null;
  const btn = $('#btn-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    S.requestPersist();
  });
}

/* ---------- boot ---------- */

function boot() {
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, unlockAudio, { once: true, capture: true });
  S.load();
  S.setSaveErrorHandler(() => toast('Could not save. Browser storage is full or blocked.'));
  hydrateIcons();
  applyTheme();
  S.subscribe((detail) => {
    if (detail.settings || detail.replaced) applyTheme();
    render();
  });

  bindPlan();
  bindFocus();
  bindDialogs();
  bindGlobal();
  setupPWA();

  let start = 'plan';
  try { start = localStorage.getItem('timebox:view') || 'plan'; } catch { /* ignore */ }
  if (timer().phase !== 'idle') start = 'focus';
  setView(VIEWS.includes(start) ? start : 'plan');

  T.initTimer(hooks);
  const t = timer();
  if (t.phase === 'focus' && t.ended && !$('#dlg-outcome').open) openOutcome();
}

boot();

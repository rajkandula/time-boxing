// Focus and break timer. Time comes from timestamps, never from counting ticks, so throttled
// background tabs, sleeping laptops and page reloads cannot make it drift.
import { store, commit, subscribe, findBox, getDay, reloadFromDisk } from './store.js';
import { idleTimer, breakFor, elapsedMs, remainingMs, dayStats } from './core.js';

const MAX_MS = 86400000;
let hooks = {};
let endTimeout = null;

const timer = () => store.state.timer;
const settings = () => store.state.settings;

export function initTimer(h) {
  hooks = h;
  setInterval(() => tick(false), 250);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick(false);
  });
  subscribe((detail) => {
    if (detail.external || detail.replaced) schedule();
  });
  schedule();
  tick(true); // a deadline may have passed while the app was closed
}

function setTimer(next, detail = {}) {
  store.state.timer = next;
  commit({ timer: true, ...detail });
  schedule();
}

// One-shot timeout at the exact deadline. Chained intervals get throttled hard in hidden
// tabs; a single timeout is only aligned to the second.
function schedule() {
  if (endTimeout) clearTimeout(endTimeout);
  endTimeout = null;
  const t = timer();
  if (t.phase !== 'idle' && t.running) {
    endTimeout = setTimeout(() => tick(false), remainingMs(t, Date.now()) + 30);
  }
}

function tick(away) {
  const t = timer();
  if (t.phase !== 'idle' && t.running && remainingMs(t, Date.now()) <= 0) reachedZero(away);
  hooks.onTick?.();
}

function reachedZero(away) {
  reloadFromDisk();
  const t = timer();
  if (t.phase === 'idle' || !t.running || remainingMs(t, Date.now()) > 0) {
    schedule();
    hooks.onExternal?.();
    return;
  }
  if (t.phase === 'focus') {
    // Stop at the box length; time spent answering the reflection does not count.
    setTimer({ ...t, running: false, ended: true, accumulatedMs: t.durationMs, startedAt: null });
    hooks.onFocusTimeUp?.(findBox(t.dayKey, t.boxId), { away });
  } else {
    setTimer(idleTimer());
    hooks.onBreakEnd?.({ away, natural: true });
  }
}

// Adds the time spent in the current focus run to its box. Callers must leave the focus
// phase right after, or the same time would be counted twice.
function commitFocusTime() {
  const t = timer();
  if (t.phase !== 'focus') return 0;
  const secs = Math.round(Math.min(elapsedMs(t, Date.now()), t.durationMs) / 1000);
  const box = findBox(t.dayKey, t.boxId);
  if (box) box.actualSeconds = Math.min(86400, box.actualSeconds + secs);
  return secs;
}

export function nextBox(dayKey) {
  return getDay(dayKey)?.boxes.find((b) => b.status === 'todo') || null;
}

export function doneCount(dayKey) {
  return dayStats(getDay(dayKey)).done;
}

export function startFocus(dayKey, boxId) {
  const box = findBox(dayKey, boxId);
  if (!box) return;
  const t = timer();
  if (t.phase === 'focus' && t.boxId === boxId) {
    if (!t.running && !t.ended) resume();
    return;
  }
  if (t.phase === 'focus') {
    commitFocusTime(); // switching boxes keeps the time already spent
    const prev = t.ended ? findBox(t.dayKey, t.boxId) : null;
    if (prev) Object.assign(prev, { status: 'done', endedAt: Date.now() });
  }
  if (box.status !== 'todo') {
    box.status = 'todo';
    box.outcome = null;
  }
  const left = box.minutes * 60 - box.actualSeconds;
  const durationMs = (left >= 60 ? left : box.minutes * 60) * 1000;
  if (!box.startedAt) box.startedAt = Date.now();
  setTimer({ ...idleTimer(), phase: 'focus', running: true, boxId, dayKey, durationMs, startedAt: Date.now() });
  hooks.onPhaseStart?.('focus');
}

export function pause() {
  const t = timer();
  if (!t.running) return;
  setTimer({ ...t, running: false, accumulatedMs: Math.min(t.durationMs, elapsedMs(t, Date.now())), startedAt: null });
}

export function resume() {
  const t = timer();
  if (t.phase === 'idle' || t.running || t.ended) return;
  setTimer({ ...t, running: true, startedAt: Date.now() });
}

export function toggle() {
  if (timer().running) pause();
  else resume();
}

export function extend(minutes = 5) {
  const t = timer();
  if (t.phase === 'idle') return;
  const durationMs = Math.min(MAX_MS, t.durationMs + minutes * 60000);
  if (t.ended) setTimer({ ...t, ended: false, running: true, startedAt: Date.now(), durationMs });
  else setTimer({ ...t, durationMs });
}

// Finishes the current focus box with a reflection, then starts or suggests a break.
export function completeFocus(outcome, note = '') {
  const t = timer();
  if (t.phase !== 'focus') return;
  const box = findBox(t.dayKey, t.boxId);
  commitFocusTime();
  if (box) Object.assign(box, { status: 'done', outcome: outcome || null, note: String(note).slice(0, 1000), endedAt: Date.now() });
  const br = breakFor(doneCount(t.dayKey), settings());
  if (br.minutes <= 0) {
    setTimer(idleTimer());
  } else if (settings().autoStartBreaks) {
    startBreak(br.phase, br.minutes);
  } else {
    setTimer({ ...idleTimer(), suggest: br.phase });
  }
}

export function skipFocus() {
  const t = timer();
  if (t.phase !== 'focus') return;
  const box = findBox(t.dayKey, t.boxId);
  commitFocusTime();
  if (box) Object.assign(box, { status: 'skipped', endedAt: Date.now() });
  setTimer(idleTimer());
}

// Cancels the current run. Focus time already spent stays logged on the box.
export function stop() {
  const t = timer();
  if (t.phase === 'idle') {
    if (t.suggest) setTimer(idleTimer());
    return 0;
  }
  const secs = t.phase === 'focus' ? commitFocusTime() : 0;
  setTimer(idleTimer());
  return secs;
}

export function startBreak(phase, minutes) {
  setTimer({ ...idleTimer(), phase, running: true, durationMs: Math.max(1, minutes) * 60000, startedAt: Date.now() });
  hooks.onPhaseStart?.(phase);
}

export function startSuggestedBreak() {
  const phase = timer().suggest || 'short';
  const minutes = phase === 'long' ? settings().longBreakMinutes : settings().shortBreakMinutes;
  if (minutes > 0) startBreak(phase, minutes);
  else setTimer(idleTimer());
}

export function skipBreak() {
  const t = timer();
  if (t.phase === 'short' || t.phase === 'long' || t.suggest) {
    setTimer(idleTimer());
    hooks.onBreakEnd?.({ away: false, natural: false });
  }
}

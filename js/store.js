// App state: loaded from localStorage, changed through these helpers, saved on every change.
// Everything stays in this browser on this device. There is no account and no server.
import {
  STORAGE_KEY, MAX_PRIORITIES, sanitizeState, defaultState, idleTimer, newDay, newBox, newInboxItem, ensureSubjectColor,
} from './core.js';

export const store = { state: defaultState(), storageOk: true };

const listeners = new Set();
let onSaveError = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSaveErrorHandler(fn) {
  onSaveError = fn;
}

function emit(detail = {}) {
  for (const fn of listeners) fn(detail);
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    store.storageOk = false;
  }
  if (raw == null) {
    store.state = defaultState();
    return;
  }
  try {
    store.state = sanitizeState(JSON.parse(raw));
  } catch {
    // Keep the unreadable copy so the next save does not destroy it.
    try {
      localStorage.setItem(`${STORAGE_KEY}:corrupt:${Date.now()}`, raw);
    } catch { /* storage full; nothing more we can do */ }
    store.state = defaultState();
  }
}

// Used right before acting on a timer deadline, in case another tab already handled it.
export function reloadFromDisk() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) store.state = sanitizeState(JSON.parse(raw));
  } catch { /* keep the in-memory copy */ }
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
    store.storageOk = true;
  } catch (err) {
    store.storageOk = false;
    onSaveError?.(err);
  }
}

export function commit(detail) {
  save();
  emit(detail);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    try {
      store.state = e.newValue == null ? defaultState() : sanitizeState(JSON.parse(e.newValue));
    } catch {
      return;
    }
    emit({ external: true });
  });
}

/* ---------- days & boxes ---------- */

export function getDay(key, create = false) {
  let day = store.state.days[key];
  if (!day && create) day = store.state.days[key] = newDay(store.state.settings);
  return day || null;
}

export function findBox(dayKey, id) {
  return getDay(dayKey)?.boxes.find((b) => b.id === id) || null;
}

export function addBox(dayKey, data) {
  const box = newBox({ minutes: store.state.settings.focusMinutes, ...data });
  getDay(dayKey, true).boxes.push(box);
  ensureSubjectColor(store.state, box.subject);
  commit();
  return box;
}

export function updateBox(dayKey, id, patch) {
  const box = findBox(dayKey, id);
  if (!box) return null;
  Object.assign(box, patch);
  ensureSubjectColor(store.state, box.subject);
  commit();
  return box;
}

function resetTimerIfOn(id) {
  const t = store.state.timer;
  if (t.phase === 'focus' && t.boxId === id) store.state.timer = idleTimer();
}

export function removeBox(dayKey, id) {
  const day = getDay(dayKey);
  if (!day) return null;
  const box = day.boxes.find((b) => b.id === id);
  if (!box) return null;
  const index = day.boxes.indexOf(box);
  day.boxes.splice(index, 1);
  resetTimerIfOn(id);
  commit();
  return { box, index };
}

export function restoreBox(dayKey, box, index) {
  const day = getDay(dayKey, true);
  day.boxes.splice(Math.min(index, day.boxes.length), 0, box);
  commit();
}

export function moveBox(dayKey, id, delta) {
  const boxes = getDay(dayKey)?.boxes;
  if (!boxes) return false;
  const i = boxes.findIndex((b) => b.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= boxes.length) return false;
  const [box] = boxes.splice(i, 1);
  boxes.splice(j, 0, box);
  commit();
  return true;
}

export function reorderBoxes(dayKey, ids) {
  const day = getDay(dayKey);
  if (!day) return;
  const byId = new Map(day.boxes.map((b) => [b.id, b]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  if (next.length !== day.boxes.length) return;
  day.boxes = next;
  commit();
}

export function setDayStart(dayKey, hhmm) {
  getDay(dayKey, true).startTime = hhmm;
  commit();
}

// Moves unfinished boxes from an earlier day into another day. Boxes that already have
// focus time logged stay behind as "skipped" so that day's stats remain true.
export function carryOver(fromKey, toKey) {
  const from = getDay(fromKey);
  if (!from) return 0;
  const activeId = store.state.timer.phase === 'focus' ? store.state.timer.boxId : null;
  const todo = from.boxes.filter((b) => b.status === 'todo' && b.id !== activeId);
  if (!todo.length) return 0;
  const to = getDay(toKey, true);
  for (const b of todo) {
    const done = Math.round(b.actualSeconds / 60);
    to.boxes.push(newBox({ title: b.title, subject: b.subject, goal: b.goal, minutes: Math.max(5, b.minutes - done) }));
    if (b.actualSeconds > 0) b.status = 'skipped';
  }
  from.boxes = from.boxes.filter((b) => !(todo.includes(b) && b.actualSeconds === 0));
  commit();
  return todo.length;
}

/* ---------- brain dump ---------- */

export function addInbox(data) {
  const item = newInboxItem(data);
  store.state.inbox.push(item);
  ensureSubjectColor(store.state, item.subject);
  commit();
  return item;
}

export function updateInbox(id, patch) {
  const item = store.state.inbox.find((i) => i.id === id);
  if (!item) return;
  Object.assign(item, patch);
  commit();
}

export function removeInbox(id) {
  const index = store.state.inbox.findIndex((i) => i.id === id);
  if (index < 0) return null;
  const [item] = store.state.inbox.splice(index, 1);
  commit();
  return { item, index };
}

export function restoreInbox(item, index) {
  store.state.inbox.splice(Math.min(index, store.state.inbox.length), 0, item);
  commit();
}

// Returns false when the top-priorities list is already full.
export function toggleStar(id) {
  const item = store.state.inbox.find((i) => i.id === id);
  if (!item) return true;
  if (!item.starred && store.state.inbox.filter((i) => i.starred).length >= MAX_PRIORITIES) return false;
  item.starred = !item.starred;
  commit();
  return true;
}

export function inboxToBox(id, dayKey) {
  const index = store.state.inbox.findIndex((i) => i.id === id);
  if (index < 0) return null;
  const item = store.state.inbox[index];
  const box = newBox({ title: item.title, subject: item.subject, minutes: item.minutes || store.state.settings.focusMinutes });
  const day = getDay(dayKey, true);
  // Priorities go ahead of ordinary boxes that have not started yet.
  if (item.starred) {
    const firstTodo = day.boxes.findIndex((b) => b.status === 'todo' && !b.actualSeconds && b.id !== store.state.timer.boxId);
    day.boxes.splice(firstTodo < 0 ? day.boxes.length : firstTodo, 0, box);
  } else {
    day.boxes.push(box);
  }
  store.state.inbox.splice(index, 1);
  commit();
  return box;
}

export function boxToInbox(dayKey, id) {
  const removed = removeBoxSilently(dayKey, id);
  if (!removed) return null;
  const item = newInboxItem({ title: removed.title, subject: removed.subject, minutes: removed.minutes });
  store.state.inbox.push(item);
  commit();
  return item;
}

function removeBoxSilently(dayKey, id) {
  const day = getDay(dayKey);
  const index = day ? day.boxes.findIndex((b) => b.id === id) : -1;
  if (index < 0) return null;
  resetTimerIfOn(id);
  return day.boxes.splice(index, 1)[0];
}

/* ---------- settings & data ---------- */

export function updateSettings(patch) {
  Object.assign(store.state.settings, patch);
  commit({ settings: true });
}

export function exportJSON() {
  return JSON.stringify({ app: 'timebox', exportedAt: new Date().toISOString(), ...store.state }, null, 2);
}

export function importJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !(raw.days || raw.inbox || raw.settings)) {
    throw new Error('This file is not a Timebox backup.');
  }
  store.state = sanitizeState(raw);
  store.state.timer = idleTimer();
  commit({ replaced: true });
}

export function clearAll() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(STORAGE_KEY)) localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
  store.state = defaultState();
  emit({ replaced: true });
}

export async function storagePersisted() {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}

export async function requestPersist() {
  try {
    return (await navigator.storage?.persist?.()) ?? null;
  } catch {
    return null;
  }
}

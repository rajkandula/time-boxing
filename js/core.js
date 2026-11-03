// Pure logic shared by the UI and the unit tests. Nothing in here touches the DOM.

export const STORAGE_KEY = 'timebox:v1';
export const SCHEMA_VERSION = 1;
export const PALETTE_SIZE = 8;
export const MAX_PRIORITIES = 3;

export const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  includeBreaks: true,
  autoStartBreaks: true,
  autoStartNext: false,
  sound: true,
  volume: 0.6,
  notifications: false,
  keepAwake: true,
  theme: 'system',
  dailyGoalMinutes: 240,
  dayStart: '09:00',
};

export const PHASES = ['idle', 'focus', 'short', 'long'];
export const OUTCOMES = ['met', 'partial', 'missed'];
export const STATUSES = ['todo', 'done', 'skipped'];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/* ---------- dates & times ---------- */

// Local calendar date. toISOString() would give the UTC date, which is wrong near midnight.
export function dateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return dateKey(parseDateKey(key)) === key;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function isHHMM(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function hhmmToMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function minutesOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function roundUpTo(mins, step) {
  return Math.ceil(mins / step) * step;
}

/* ---------- formatting ---------- */

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function formatTimeOfDay(mins, locale) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/* ---------- quick-add parsing: "Biology ch. 5 #bio 45m" ---------- */

const DURATION_RE =
  /\s(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minute|minutes))?(?=\s)|\s(\d+)\s*(?:m|min|mins|minute|minutes)(?=\s)/i;

export function parseQuickAdd(input) {
  let text = ` ${String(input ?? '')} `;
  let subject = '';
  let minutes = null;
  text = text.replace(/\s#([^\s#]+)/g, (_, tag) => {
    if (!subject) subject = tag;
    return ' ';
  });
  const m = text.match(DURATION_RE);
  if (m) {
    minutes = m[1] != null
      ? Math.round(parseFloat(m[1]) * 60) + (m[2] ? parseInt(m[2], 10) : 0)
      : parseInt(m[3], 10);
    text = text.replace(m[0], ' ');
    minutes = minutes > 0 ? clamp(minutes, 1, 480) : null;
  }
  return { title: text.replace(/\s+/g, ' ').trim(), subject: subject.slice(0, 40), minutes };
}

/* ---------- subjects ---------- */

export const subjectKey = (subject) => String(subject || '').trim().toLowerCase().slice(0, 40);

// Fallback colour for a subject that has no assigned slot yet.
export function subjectColor(subject) {
  const s = String(subject || '').trim().toLowerCase();
  if (!s) return -1;
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  return hash % PALETTE_SIZE;
}

// Gives each new subject the least-used palette slot, so the first eight subjects
// a student uses always get distinct colours. Mutates state.colors.
export function ensureSubjectColor(state, subject) {
  const key = subjectKey(subject);
  if (!key || key in state.colors) return;
  const counts = new Array(PALETTE_SIZE).fill(0);
  for (const k in state.colors) counts[state.colors[k]]++;
  state.colors[key] = counts.indexOf(Math.min(...counts));
}

/* ---------- model factories ---------- */

export function idleTimer() {
  return {
    phase: 'idle', running: false, ended: false, boxId: null, dayKey: null,
    durationMs: 0, accumulatedMs: 0, startedAt: null, suggest: null,
  };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, inbox: [], days: {},
    colors: Object.create(null), timer: idleTimer(),
  };
}

export function newDay(settings) {
  return { startTime: settings?.dayStart || DEFAULT_SETTINGS.dayStart, boxes: [] };
}

export function newBox({ title, subject = '', minutes = 25, goal = '' }) {
  return {
    id: uid(), title: String(title).slice(0, 120), subject: String(subject).slice(0, 40),
    minutes: clamp(Math.round(minutes) || 25, 1, 480), goal: String(goal).slice(0, 300),
    status: 'todo', outcome: null, note: '', actualSeconds: 0, startedAt: null, endedAt: null,
  };
}

export function newInboxItem({ title, subject = '', minutes = null }) {
  return {
    id: uid(), title: String(title).slice(0, 120), subject: String(subject).slice(0, 40),
    minutes: minutes ? clamp(Math.round(minutes), 1, 480) : null, starred: false, createdAt: Date.now(),
  };
}

/* ---------- schedule ---------- */

export function breakFor(cycle, settings) {
  const every = settings.longBreakEvery;
  const long = every > 0 && cycle > 0 && cycle % every === 0;
  return long
    ? { phase: 'long', minutes: settings.longBreakMinutes }
    : { phase: 'short', minutes: settings.shortBreakMinutes };
}

// Lays boxes end to end from a start time, with optional breaks between them.
export function buildSchedule(boxes, startMinutes, settings, includeBreaks = settings.includeBreaks) {
  const rows = [];
  let t = startMinutes;
  boxes.forEach((box, i) => {
    rows.push({ type: 'box', box, start: t, end: t + box.minutes });
    t += box.minutes;
    if (includeBreaks && i < boxes.length - 1) {
      const br = breakFor(i + 1, settings);
      if (br.minutes > 0) {
        rows.push({ type: 'break', long: br.phase === 'long', start: t, end: t + br.minutes });
        t += br.minutes;
      }
    }
  });
  return { rows, end: t };
}

// Minutes of work (plus breaks) still ahead for the boxes that are not finished.
export function remainingPlanMinutes(boxes, settings) {
  const left = boxes
    .filter((b) => b.status === 'todo')
    .map((b) => ({ ...b, minutes: Math.max(0, b.minutes - (b.actualSeconds || 0) / 60) }));
  return buildSchedule(left, 0, settings).end;
}

/* ---------- timer math ---------- */

export function elapsedMs(timer, now) {
  return timer.accumulatedMs + (timer.running && timer.startedAt != null ? Math.max(0, now - timer.startedAt) : 0);
}

export function remainingMs(timer, now) {
  return Math.max(0, timer.durationMs - elapsedMs(timer, now));
}

/* ---------- stats ---------- */

export function dayStats(day) {
  const boxes = day?.boxes || [];
  const s = { planned: boxes.length, done: 0, skipped: 0, todo: 0, focusSeconds: 0, plannedMinutes: 0, rated: 0, met: 0 };
  for (const b of boxes) {
    s.plannedMinutes += b.minutes;
    s.focusSeconds += b.actualSeconds || 0;
    if (b.status === 'done') s.done++;
    else if (b.status === 'skipped') s.skipped++;
    else s.todo++;
    if (b.outcome) {
      s.rated++;
      if (b.outcome === 'met') s.met++;
    }
  }
  s.metRate = s.rated ? s.met / s.rated : null;
  return s;
}

// Consecutive days with at least one finished box. Today only counts once it has one.
export function streak(days, todayKey) {
  const active = (k) => (days[k]?.boxes || []).some((b) => b.status === 'done');
  let k = active(todayKey) ? todayKey : addDays(todayKey, -1);
  let n = 0;
  while (active(k) && n < 3660) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function weekSeries(days, endKey, n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(endKey, -i);
    out.push({ key, minutes: Math.round(dayStats(days[key]).focusSeconds / 60) });
  }
  return out;
}

export function subjectTotals(days, keys) {
  const map = new Map();
  for (const key of keys) {
    for (const b of days[key]?.boxes || []) {
      if (!b.actualSeconds) continue;
      const name = b.subject.trim() || 'No subject';
      map.set(name, (map.get(name) || 0) + b.actualSeconds);
    }
  }
  return [...map.entries()].map(([subject, seconds]) => ({ subject, seconds })).sort((a, b) => b.seconds - a.seconds);
}

/* ---------- validation (used on load and on import) ---------- */

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, min, max, dflt) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Math.round(Number(v)), min, max) : dflt);
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
const list = (v) => (Array.isArray(v) ? v : []);
const ts = (v) => (Number.isFinite(v) && v > 0 ? v : null);

function sanitizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    focusMinutes: int(s.focusMinutes, 1, 240, d.focusMinutes),
    shortBreakMinutes: int(s.shortBreakMinutes, 0, 60, d.shortBreakMinutes),
    longBreakMinutes: int(s.longBreakMinutes, 0, 120, d.longBreakMinutes),
    longBreakEvery: int(s.longBreakEvery, 0, 12, d.longBreakEvery),
    includeBreaks: bool(s.includeBreaks, d.includeBreaks),
    autoStartBreaks: bool(s.autoStartBreaks, d.autoStartBreaks),
    autoStartNext: bool(s.autoStartNext, d.autoStartNext),
    sound: bool(s.sound, d.sound),
    volume: Number.isFinite(s.volume) ? clamp(s.volume, 0, 1) : d.volume,
    notifications: bool(s.notifications, d.notifications),
    keepAwake: bool(s.keepAwake, d.keepAwake),
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : d.theme,
    dailyGoalMinutes: int(s.dailyGoalMinutes, 0, 1440, d.dailyGoalMinutes),
    dayStart: isHHMM(s.dayStart) ? s.dayStart : d.dayStart,
  };
}

function sanitizeBox(b, seen) {
  if (!b || typeof b !== 'object') return null;
  const title = str(b.title, 120).trim();
  if (!title) return null;
  let id = str(b.id, 40);
  if (!id || seen.has(id)) id = uid();
  seen.add(id);
  return {
    id, title, subject: str(b.subject, 40), minutes: int(b.minutes, 1, 480, 25), goal: str(b.goal, 300),
    status: STATUSES.includes(b.status) ? b.status : 'todo',
    outcome: OUTCOMES.includes(b.outcome) ? b.outcome : null,
    note: str(b.note, 1000), actualSeconds: int(b.actualSeconds, 0, 86400, 0),
    startedAt: ts(b.startedAt), endedAt: ts(b.endedAt),
  };
}

function sanitizeInboxItem(it, seen) {
  if (!it || typeof it !== 'object') return null;
  const title = str(it.title, 120).trim();
  if (!title) return null;
  let id = str(it.id, 40);
  if (!id || seen.has(id)) id = uid();
  seen.add(id);
  return {
    id, title, subject: str(it.subject, 40), minutes: it.minutes == null ? null : int(it.minutes, 1, 480, null),
    starred: bool(it.starred, false), createdAt: ts(it.createdAt) || Date.now(),
  };
}

function sanitizeTimer(t, days) {
  if (!t || typeof t !== 'object' || !PHASES.includes(t.phase)) return idleTimer();
  if (t.phase === 'idle') {
    const timer = idleTimer();
    timer.suggest = ['short', 'long'].includes(t.suggest) ? t.suggest : null;
    return timer;
  }
  const durationMs = int(t.durationMs, 1000, 86400000, 0);
  if (!durationMs) return idleTimer();
  if (t.phase === 'focus') {
    const box = isDateKey(t.dayKey) && days[t.dayKey]?.boxes.find((b) => b.id === t.boxId);
    if (!box) return idleTimer();
  }
  const startedAt = ts(t.startedAt);
  const running = bool(t.running, false) && startedAt != null;
  return {
    phase: t.phase, running, ended: bool(t.ended, false) && !running,
    boxId: t.phase === 'focus' ? t.boxId : null, dayKey: t.phase === 'focus' ? t.dayKey : null,
    durationMs, accumulatedMs: int(t.accumulatedMs, 0, durationMs, 0), startedAt: running ? startedAt : null,
    suggest: null,
  };
}

export function sanitizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;
  state.settings = sanitizeSettings(raw.settings && typeof raw.settings === 'object' ? raw.settings : {});
  const seenInbox = new Set();
  state.inbox = list(raw.inbox).map((it) => sanitizeInboxItem(it, seenInbox)).filter(Boolean).slice(0, 500);
  if (raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
    for (const [key, day] of Object.entries(raw.days)) {
      if (!isDateKey(key) || !day || typeof day !== 'object') continue;
      const seen = new Set();
      state.days[key] = {
        startTime: isHHMM(day.startTime) ? day.startTime : state.settings.dayStart,
        boxes: list(day.boxes).map((b) => sanitizeBox(b, seen)).filter(Boolean).slice(0, 100),
      };
    }
  }
  if (raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors)) {
    for (const [k, v] of Object.entries(raw.colors).slice(0, 300)) {
      const key = subjectKey(k);
      if (key && Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE) state.colors[key] = v;
    }
  }
  for (const key of Object.keys(state.days).sort()) {
    for (const b of state.days[key].boxes) ensureSubjectColor(state, b.subject);
  }
  for (const it of state.inbox) ensureSubjectColor(state, it.subject);
  state.timer = sanitizeTimer(raw.timer, state.days);
  return state;
}

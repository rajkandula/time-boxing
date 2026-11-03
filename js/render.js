// Turns state into DOM. Every function here is safe to call repeatedly.
import { store, getDay, findBox } from './store.js';
import { h, icon } from './ui.js';
import { nextBox, doneCount } from './timer.js';
import {
  addDays, parseDateKey, hhmmToMinutes, formatClock, formatDuration, formatTimeOfDay, minutesOfDay,
  subjectColor, subjectKey, buildSchedule, remainingPlanMinutes, remainingMs, dayStats, streak, weekSeries, subjectTotals,
} from './core.js';

const RING = 2 * Math.PI * 100;
const el = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function colorVar(subject) {
  const key = subjectKey(subject);
  if (!key) return 'var(--border-strong)';
  return `var(--s${store.state.colors[key] ?? subjectColor(subject)})`;
}

function tag(subject) {
  return subject ? h('span', { class: 'tag', style: { '--c': colorVar(subject) } }, h('span', null, subject)) : null;
}

export function dayLabel(key, today) {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: 'long' });
}

export function longDate(key) {
  const d = parseDateKey(key);
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

// Seconds the timer will run for when this box starts (the unspent part of the box).
export function plannedSeconds(box) {
  const left = box.minutes * 60 - box.actualSeconds;
  return left >= 60 ? left : box.minutes * 60;
}

function phaseName(phase) {
  return { focus: 'Focus', short: 'Short break', long: 'Long break' }[phase] || 'Ready';
}

/* ---------- plan ---------- */

function findCarrySource(today) {
  for (let i = 1; i <= 14; i++) {
    const key = addDays(today, -i);
    const n = (getDay(key)?.boxes || []).filter((b) => b.status === 'todo').length;
    if (n) return { key, n };
  }
  return null;
}

function taskItem(item, dayName) {
  return h('li', { class: `task${item.starred ? ' is-priority' : ''}`, dataset: { id: item.id } },
    h('button', {
      type: 'button', class: 'icon-btn sm star-btn', dataset: { action: 'star' }, 'aria-pressed': String(item.starred),
      'aria-label': item.starred ? `Remove “${item.title}” from top priorities` : `Make “${item.title}” a top priority`,
      title: item.starred ? 'Remove from top 3' : 'Make a top-3 priority',
    }, icon('star', 17)),
    h('div', { class: 'task-body' },
      h('div', { class: 'task-title' }, item.title),
      h('div', { class: 'task-meta' }, tag(item.subject), item.minutes ? formatDuration(item.minutes) : null)),
    h('div', { class: 'task-actions' },
      h('button', {
        type: 'button', class: 'icon-btn sm box-it', dataset: { action: 'box' },
        'aria-label': `Box “${item.title}” into ${dayName}`, title: `Box it into ${dayName}`,
      }, icon('arrowRight', 17)),
      h('button', {
        type: 'button', class: 'icon-btn sm del-btn', dataset: { action: 'delete' },
        'aria-label': `Delete “${item.title}”`, title: 'Delete',
      }, icon('trash', 16))));
}

function boxItem(row, ui) {
  const { box } = row;
  const t = store.state.timer;
  const active = t.phase === 'focus' && t.boxId === box.id && t.dayKey === ui.dayKey;
  const cls = ['box', `is-${box.status}`, active ? 'is-active' : ''].filter(Boolean).join(' ');
  const done = box.actualSeconds >= 60 ? `${formatDuration(box.actualSeconds / 60)} done` : null;
  let status = null;
  if (active) {
    status = h('span', { class: 'status-pill live' }, t.ended ? "Time's up" : t.running ? 'In progress' : 'Paused');
  } else if (box.status === 'done') {
    const label = { met: 'Goal met', partial: 'Partly', missed: 'Not yet' }[box.outcome] || 'Done';
    status = h('span', { class: 'status-pill done' }, icon('check', 13), label);
  } else if (box.status === 'skipped') {
    status = h('span', { class: 'status-pill skipped' }, 'Skipped');
  } else if (ui.dayKey === ui.today) {
    status = h('button', {
      type: 'button', class: 'btn btn-sm btn-soft btn-start', dataset: { action: 'start' },
      'aria-label': `${box.actualSeconds ? 'Resume' : 'Start'} “${box.title}”`,
    }, icon('play', 14), h('span', null, box.actualSeconds ? 'Resume' : 'Start'));
  }
  return h('li', { class: cls, dataset: { id: box.id }, style: { '--c': colorVar(box.subject) } },
    h('button', {
      type: 'button', class: 'drag-handle', dataset: { action: 'drag' },
      'aria-label': `Reorder “${box.title}”. Drag, or use the up and down arrow keys.`, title: 'Drag to reorder',
    }, icon('grip', 16)),
    h('div', { class: 'box-time' },
      h('strong', null, formatTimeOfDay(row.start)), h('span', null, formatTimeOfDay(row.end))),
    h('div', { class: 'box-main' },
      h('div', { class: 'box-title' }, box.title),
      h('div', { class: 'box-meta' },
        tag(box.subject),
        h('span', null, formatDuration(box.minutes)),
        done && h('span', null, done),
        box.goal && h('span', { class: 'goal' }, icon('target', 13), box.goal))),
    h('div', { class: 'box-actions' },
      status,
      h('button', {
        type: 'button', class: 'icon-btn sm', dataset: { action: 'edit' },
        'aria-label': `Edit “${box.title}”`, title: 'Edit',
      }, icon('edit', 16))));
}

function breakItem(row) {
  const mins = row.end - row.start;
  return h('li', { class: 'break-row', 'aria-hidden': 'true' },
    icon('coffee', 14), `${formatDuration(mins)} ${row.long ? 'long break' : 'break'}`);
}

export function renderPlan(ui) {
  const { dayKey, today } = ui;
  const { settings, inbox } = store.state;
  const day = getDay(dayKey);
  const boxes = day?.boxes || [];
  const name = dayLabel(dayKey, today);

  el('day-title').textContent = name;
  el('day-subtitle').textContent = longDate(dayKey);
  el('day-today').hidden = dayKey === today;

  const carry = dayKey === today ? findCarrySource(today) : null;
  el('carry-banner').hidden = !carry;
  if (carry) {
    el('carry-text').textContent = `${plural(carry.n, 'unfinished box')} from ${dayLabel(carry.key, today).toLowerCase() === 'yesterday' ? 'yesterday' : longDate(carry.key)}.`;
    el('btn-carry').dataset.from = carry.key;
  }

  // Brain dump
  const priorities = inbox.filter((i) => i.starred);
  const others = inbox.filter((i) => !i.starred);
  const dumpName = name.toLowerCase() === 'today' ? 'today' : name;
  el('priority-list').replaceChildren(...priorities.map((i) => taskItem(i, dumpName)));
  el('dump-list').replaceChildren(...others.map((i) => taskItem(i, dumpName)));
  el('priority-empty').hidden = priorities.length > 0;
  el('dump-empty').hidden = others.length > 0;
  el('dump-count').textContent = inbox.length ? plural(inbox.length, 'task') : '';

  // Schedule
  const startTime = day?.startTime || settings.dayStart;
  const startInput = el('day-start');
  if (document.activeElement !== startInput) startInput.value = startTime;
  const { rows, end } = buildSchedule(boxes, hhmmToMinutes(startTime), settings);
  const list = el('box-list');
  if (!list.classList.contains('sorting')) {
    list.replaceChildren(...rows.map((r) => (r.type === 'box' ? boxItem(r, ui) : breakItem(r))));
  }
  el('box-empty').hidden = boxes.length > 0;

  const stats = dayStats(day);
  const summary = el('day-summary');
  if (!boxes.length) {
    summary.textContent = 'Plan your day as a series of focused blocks.';
  } else {
    const parts = [
      h('strong', null, plural(boxes.length, 'box')),
      ` · ${formatDuration(stats.plannedMinutes)} of focus · ${formatTimeOfDay(hhmmToMinutes(startTime))} – ${formatTimeOfDay(end)}`,
    ];
    if (dayKey === today && stats.todo > 0 && minutesOfDay() >= hhmmToMinutes(startTime)) {
      const left = remainingPlanMinutes(boxes, settings);
      parts.push(` · at this pace, done by ${formatTimeOfDay(minutesOfDay() + left)}`);
    }
    summary.replaceChildren(...parts);
  }
  const pct = boxes.length ? Math.round((stats.done / boxes.length) * 100) : 0;
  const bar = el('day-progress');
  bar.firstElementChild.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  bar.setAttribute('aria-valuetext', `${stats.done} of ${boxes.length} boxes finished`);

  // Subject suggestions from everything the user has typed before
  const subjects = new Set(inbox.map((i) => i.subject).filter(Boolean));
  for (const d of Object.values(store.state.days)) for (const b of d.boxes) if (b.subject) subjects.add(b.subject);
  el('subject-options').replaceChildren(...[...subjects].sort().slice(0, 50).map((s) => h('option', { value: s })));
}

/* ---------- focus ---------- */

let lastClock = '';

export function renderFocus(ui) {
  const t = store.state.timer;
  const s = store.state.settings;
  const box = t.phase === 'focus' ? findBox(t.dayKey, t.boxId) : null;
  const next = nextBox(ui.today);
  const card = el('focus-card');
  const isBreak = t.phase === 'short' || t.phase === 'long';
  const paused = t.phase !== 'idle' && !t.running && !t.ended;

  card.dataset.phase = t.phase === 'idle' ? (t.suggest ? t.suggest : 'focus') : t.phase;
  card.classList.toggle('is-paused', paused);
  card.classList.toggle('is-ended', !!t.ended);

  let pill = phaseName(t.phase);
  if (t.phase === 'idle' && t.suggest) pill = 'Break time';
  if (t.ended) pill = "Time's up";
  else if (paused) pill += ' · paused';
  el('phase-pill').textContent = pill;

  let title = '';
  let subject = '';
  if (box) {
    title = box.title;
    subject = box.subject;
  } else if (isBreak || t.suggest) {
    title = 'Stretch, drink water, rest your eyes';
  } else if (next) {
    title = next.title;
    subject = next.subject;
  } else {
    title = 'Nothing planned. Start a quick box.';
  }
  el('timer-title').textContent = title;
  el('timer-subject').replaceChildren(...[tag(subject)].filter(Boolean));

  const goal = el('focus-goal');
  goal.hidden = !box?.goal;
  if (box?.goal) goal.replaceChildren(h('strong', null, 'Goal: '), box.goal);

  // Main button
  let action = 'start-next';
  let label = 'Start';
  let ic = 'play';
  if (t.phase === 'idle') {
    if (t.suggest) {
      action = 'start-break';
      label = `Start ${t.suggest === 'long' ? s.longBreakMinutes : s.shortBreakMinutes}m break`;
      ic = 'coffee';
    } else if (!next) {
      action = 'quick';
      label = `Start ${s.focusMinutes}m`;
    }
  } else if (t.ended) {
    action = 'finish';
    label = 'Log & finish';
    ic = 'check';
  } else if (t.running) {
    action = 'pause';
    label = 'Pause';
    ic = 'pause';
  } else {
    action = 'resume';
    label = 'Resume';
  }
  const main = el('ctl-main');
  main.dataset.action = action;
  el('ctl-main-label').textContent = label;
  el('ctl-main-icon').replaceChildren(icon(ic, 22));

  const stop = el('ctl-stop');
  stop.disabled = t.phase === 'idle' && !t.suggest;
  stop.setAttribute('aria-label', t.suggest ? 'Dismiss break' : 'Stop timer');
  stop.title = t.suggest ? 'Dismiss break' : 'Stop (time so far is kept)';
  el('ctl-extend').disabled = t.phase === 'idle';
  el('ctl-finish').disabled = t.phase !== 'focus';
  const skip = el('ctl-skip');
  skip.disabled = t.phase === 'idle' && !t.suggest;
  const skipLabel = t.phase === 'focus' ? 'Skip this box' : 'Skip break';
  skip.setAttribute('aria-label', skipLabel);
  skip.title = `${skipLabel} (S)`;

  // Long-break cycle dots
  const dots = el('cycle-dots');
  const every = s.longBreakEvery;
  if (every > 0) {
    const done = doneCount(ui.today);
    const filled = done % every === 0 && done > 0 && (isBreak || t.suggest) ? every : done % every;
    dots.replaceChildren(...Array.from({ length: every }, (_, i) => h('span', { class: i < filled ? 'on' : '' })));
    dots.setAttribute('aria-label', `${filled} of ${every} boxes before a long break`);
  } else {
    dots.replaceChildren();
    dots.removeAttribute('aria-label');
  }

  let hint = '';
  if (t.phase === 'idle') hint = t.suggest ? 'Breaks keep your focus sharp for the next box.' : next ? 'Press Space to start.' : '';
  else if (t.ended) hint = 'Log how it went to move on, or add 5 more minutes.';
  else if (paused) hint = 'Paused. Press Space to resume.';
  else {
    const endsAt = new Date(Date.now() + remainingMs(t, Date.now()));
    const at = endsAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    hint = isBreak && next ? `Ends at ${at}. Next up: ${next.title}` : `Ends at ${at}`;
  }
  el('focus-hint').textContent = hint;

  // Up next
  const todo = (getDay(ui.today)?.boxes || []).filter((b) => b.status === 'todo' && !(t.phase === 'focus' && b.id === t.boxId));
  el('upnext-list').replaceChildren(...todo.slice(0, 6).map((b) =>
    h('li', { style: { '--c': colorVar(b.subject) }, dataset: { id: b.id } },
      h('div', { class: 'upnext-body' },
        h('div', { class: 't' }, b.title),
        h('div', { class: 'm' }, `${formatDuration(plannedSeconds(b) / 60)}${b.subject ? ` · ${b.subject}` : ''}`)),
      h('button', {
        type: 'button', class: 'icon-btn sm', dataset: { action: 'start-box' },
        'aria-label': `Start “${b.title}”`, title: 'Start now',
      }, icon('play', 16)))));
  el('upnext-empty').hidden = todo.length > 0;
  const minsLeft = todo.reduce((sum, b) => sum + plannedSeconds(b) / 60, 0);
  el('upnext-meta').textContent = todo.length ? `${plural(todo.length, 'box')} · ${formatDuration(minsLeft)}` : '';

  lastClock = '';
  updateClock(ui);
}

// Runs every tick, so it only touches what changes.
export function updateClock(ui) {
  const t = store.state.timer;
  const s = store.state.settings;
  let secs;
  let progress = 0;
  if (t.phase === 'idle') {
    const next = nextBox(ui.today);
    if (t.suggest) secs = (t.suggest === 'long' ? s.longBreakMinutes : s.shortBreakMinutes) * 60;
    else secs = next ? plannedSeconds(next) : s.focusMinutes * 60;
  } else {
    const rem = remainingMs(t, Date.now());
    secs = Math.ceil(rem / 1000);
    progress = t.durationMs ? 1 - rem / t.durationMs : 0;
  }
  el('ring-progress').style.strokeDashoffset = String(RING * Math.min(1, Math.max(0, progress)));

  const text = formatClock(secs);
  if (text === lastClock) return;
  lastClock = text;
  el('timer-display').textContent = text;

  const active = t.phase !== 'idle';
  const box = t.phase === 'focus' ? findBox(t.dayKey, t.boxId) : null;
  if (!active) document.title = 'Timebox — Focused Study Planner';
  else if (t.ended) document.title = "Time's up! — Timebox";
  else document.title = `${t.running ? '' : '⏸ '}${text} · ${phaseName(t.phase)} — Timebox`;

  const live = el('tab-live');
  live.hidden = !active;
  live.textContent = t.ended ? '0:00' : text;
  live.dataset.phase = t.phase;

  const mini = el('mini-timer');
  mini.hidden = !active || ui.view === 'focus';
  mini.dataset.phase = t.phase;
  mini.classList.toggle('is-running', t.running);
  el('mini-label').textContent = box ? box.title : phaseName(t.phase);
  el('mini-time').textContent = t.ended ? "Time's up" : text;
  mini.setAttribute('aria-label', `${phaseName(t.phase)}: ${t.ended ? "time's up" : `${text} left`}. Open focus view.`);
}

/* ---------- review ---------- */

export function renderReview(ui) {
  const { dayKey, today } = ui;
  const { days, settings } = store.state;
  const day = getDay(dayKey);
  const stats = dayStats(day);
  const name = dayLabel(dayKey, today);

  el('review-title').textContent = name === 'Today' ? 'Today’s review' : `Review · ${name}`;
  el('review-sub').textContent = longDate(dayKey);

  const focusMin = stats.focusSeconds / 60;
  const goal = settings.dailyGoalMinutes;
  el('stat-focus').textContent = formatDuration(focusMin);
  el('stat-goal-bar').style.width = `${goal ? Math.min(100, (focusMin / goal) * 100) : 0}%`;
  el('stat-focus-sub').textContent = goal ? `${Math.round((focusMin / goal) * 100)}% of your ${formatDuration(goal)} goal` : 'No daily goal set';

  el('stat-done').textContent = String(stats.done);
  el('stat-done-sub').textContent = stats.planned
    ? `of ${plural(stats.planned, 'box')} planned${stats.skipped ? ` · ${stats.skipped} skipped` : ''}`
    : 'Nothing planned';

  el('stat-met').textContent = stats.metRate == null ? '—' : `${Math.round(stats.metRate * 100)}%`;
  el('stat-met-sub').textContent = stats.rated ? `${stats.met} of ${plural(stats.rated, 'rated box')}` : 'Rate boxes when they end';

  const n = streak(days, today);
  el('stat-streak').textContent = plural(n, 'day');
  el('stat-streak-sub').textContent = n ? 'Days in a row with a finished box' : 'Finish a box to start a streak';

  // Week chart
  const series = weekSeries(days, dayKey);
  const max = Math.max(goal, ...series.map((d) => d.minutes), 30) * 1.08;
  const chart = el('week-chart');
  const bars = series.map((d) => {
    const date = parseDateKey(d.key);
    return h('div', { class: `wbar${d.key === dayKey ? ' is-current' : ''}` },
      h('span', { class: 'wbar-val' }, d.minutes ? formatDuration(d.minutes) : '–'),
      h('div', { class: 'wbar-track' }, h('div', { class: 'wbar-fill', style: { height: `${(d.minutes / max) * 100}%` } })),
      h('span', { class: 'wbar-day' }, date.toLocaleDateString(undefined, { weekday: 'short' })));
  });
  chart.replaceChildren(...bars);
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `Focus time, last 7 days: ${series.map((d) =>
    `${parseDateKey(d.key).toLocaleDateString(undefined, { weekday: 'long' })} ${formatDuration(d.minutes)}`).join(', ')}`);
  const total = series.reduce((sum, d) => sum + d.minutes, 0);
  el('week-total').textContent = `${formatDuration(total)} total${goal ? ` · goal ${formatDuration(goal)}/day` : ''}`;
  if (goal) {
    requestAnimationFrame(() => {
      const track = chart.querySelector('.wbar-track');
      if (!track) return;
      chart.querySelector('.goal-line')?.remove();
      const top = track.offsetTop + track.offsetHeight * (1 - goal / max);
      chart.append(h('div', { class: 'goal-line', style: { top: `${top}px` }, title: `Daily goal: ${formatDuration(goal)}` }));
    });
  }

  // Subjects
  const subjects = subjectTotals(days, series.map((d) => d.key));
  const top = subjects[0]?.seconds || 1;
  el('subject-chart').replaceChildren(...(subjects.length
    ? subjects.slice(0, 8).map((s) => h('div', { class: 'srow' },
      h('span', { class: 'name' }, s.subject),
      h('span', { class: 'val' }, formatDuration(s.seconds / 60)),
      h('div', { class: 'sbar' }, h('span', { style: { width: `${(s.seconds / top) * 100}%`, '--c': s.subject === 'No subject' ? 'var(--muted)' : colorVar(s.subject) } }))))
    : [h('p', { class: 'empty-sm' }, 'No focus time in the last 7 days yet.')]));

  // Log
  const logged = (day?.boxes || [])
    .filter((b) => b.status !== 'todo' || b.actualSeconds > 0)
    .sort((a, b) => (a.endedAt || a.startedAt || 0) - (b.endedAt || b.startedAt || 0));
  el('log-list').replaceChildren(...logged.map((b) => {
    const kind = b.status === 'skipped' ? 'skipped' : b.outcome || (b.status === 'done' ? 'done' : 'progress');
    const iconName = { met: 'check', partial: 'target', missed: 'x', skipped: 'skip', done: 'check', progress: 'clock' }[kind];
    const outcomeText = { met: 'Goal met', partial: 'Partly done', missed: 'Goal not met', skipped: 'Skipped', done: 'Finished', progress: 'In progress' }[kind];
    const when = b.endedAt || b.startedAt;
    return h('li', { class: 'log-item' },
      h('span', { class: `log-icon ${kind}` }, icon(iconName, 16)),
      h('div', null,
        h('div', { class: 'log-title' }, b.title),
        h('div', { class: 'log-meta' }, tag(b.subject), `${formatDuration(b.actualSeconds / 60)} of ${formatDuration(b.minutes)}`, ` · ${outcomeText}`),
        b.note && h('p', { class: 'log-note' }, b.note)),
      h('span', { class: 'log-time' }, when ? new Date(when).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''));
  }));
  el('log-empty').hidden = logged.length > 0;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey, isDateKey, addDays, hhmmToMinutes, minutesToHHMM, formatClock, formatDuration, parseQuickAdd,
  subjectColor, breakFor, buildSchedule, remainingPlanMinutes, elapsedMs, remainingMs, dayStats, streak,
  weekSeries, subjectTotals, sanitizeState, defaultState, DEFAULT_SETTINGS, newBox, ensureSubjectColor,
} from '../js/core.js';

const S = { ...DEFAULT_SETTINGS, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 2 };

test('dateKey uses the local calendar date', () => {
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dateKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});

test('isDateKey rejects impossible dates and other shapes', () => {
  assert.ok(isDateKey('2028-02-29'));
  assert.ok(!isDateKey('2026-02-30'));
  assert.ok(!isDateKey('2026-2-3'));
  assert.ok(!isDateKey('__proto__'));
});

test('addDays crosses month, year and DST boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
});

test('HH:MM conversions', () => {
  assert.equal(hhmmToMinutes('09:30'), 570);
  assert.equal(minutesToHHMM(570), '09:30');
  assert.equal(minutesToHHMM(1445), '00:05');
});

test('formatClock and formatDuration', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(59), '00:59');
  assert.equal(formatClock(1500), '25:00');
  assert.equal(formatClock(3600), '1:00:00');
  assert.equal(formatClock(-5), '00:00');
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(90), '1h 30m');
});

test('parseQuickAdd pulls out #subject and a length', () => {
  assert.deepEqual(parseQuickAdd('Biology ch. 5 #bio 45m'), { title: 'Biology ch. 5', subject: 'bio', minutes: 45 });
  assert.deepEqual(parseQuickAdd('Essay draft 1h30m #english'), { title: 'Essay draft', subject: 'english', minutes: 90 });
  assert.equal(parseQuickAdd('Read 1.5h').minutes, 90);
  assert.equal(parseQuickAdd('Flashcards 20 min').minutes, 20);
  assert.equal(parseQuickAdd('Past paper 2 hours').minutes, 120);
});

test('parseQuickAdd leaves ordinary numbers alone', () => {
  assert.deepEqual(parseQuickAdd('Practice 2 chapters'), { title: 'Practice 2 chapters', subject: '', minutes: null });
  assert.deepEqual(parseQuickAdd('#math'), { title: '', subject: 'math', minutes: null });
  assert.equal(parseQuickAdd('Calc 0m').minutes, null);
  assert.equal(parseQuickAdd('Marathon 900m').minutes, 480);
});

test('subjectColor is stable and case-insensitive', () => {
  assert.equal(subjectColor(''), -1);
  assert.equal(subjectColor('Math'), subjectColor('math '));
  assert.ok(subjectColor('physics') >= 0 && subjectColor('physics') < 8);
});

test('subjects get distinct colours in order of first use', () => {
  const state = defaultState();
  const subjects = ['math', 'bio', 'english', 'history', 'chem', 'spanish', 'physics', 'art'];
  for (const s of subjects) ensureSubjectColor(state, s);
  ensureSubjectColor(state, ' MATH ');
  assert.equal(new Set(subjects.map((s) => state.colors[s])).size, 8);
  assert.equal(Object.keys(state.colors).length, 8, 'case and spacing do not create a new subject');
  ensureSubjectColor(state, 'music');
  assert.ok(state.colors.music >= 0 && state.colors.music < 8);

  const loaded = sanitizeState({ days: { '2026-11-03': { boxes: [{ title: 'a', subject: 'Math' }, { title: 'b', subject: 'Bio' }] } } });
  assert.notEqual(loaded.colors.math, loaded.colors.bio);
});

test('breakFor gives a long break every N finished boxes', () => {
  assert.equal(breakFor(1, S).phase, 'short');
  assert.equal(breakFor(2, S).phase, 'long');
  assert.equal(breakFor(4, S).minutes, 15);
  assert.equal(breakFor(3, { ...S, longBreakEvery: 0 }).phase, 'short');
});

test('buildSchedule lays boxes and breaks end to end', () => {
  const boxes = [newBox({ title: 'A', minutes: 25 }), newBox({ title: 'B', minutes: 25 }), newBox({ title: 'C', minutes: 25 })];
  const { rows, end } = buildSchedule(boxes, 540, S, true);
  assert.deepEqual(rows.map((r) => [r.type, r.start, r.end]), [
    ['box', 540, 565], ['break', 565, 570], ['box', 570, 595], ['break', 595, 610], ['box', 610, 635],
  ]);
  assert.equal(end, 635);
  assert.equal(buildSchedule(boxes, 540, S, false).end, 615);
  assert.equal(buildSchedule([], 540, S).end, 540);
});

test('remainingPlanMinutes skips finished boxes and time already spent', () => {
  const a = { ...newBox({ title: 'A', minutes: 30 }), status: 'done' };
  const b = { ...newBox({ title: 'B', minutes: 30 }), actualSeconds: 600 };
  const c = newBox({ title: 'C', minutes: 30 });
  assert.equal(remainingPlanMinutes([a, b, c], { ...S, includeBreaks: false }), 50);
  assert.equal(remainingPlanMinutes([a, b, c], { ...S, includeBreaks: true }), 55);
});

test('timer math survives pauses', () => {
  const running = { durationMs: 60000, accumulatedMs: 10000, startedAt: 1000, running: true };
  assert.equal(elapsedMs(running, 21000), 30000);
  assert.equal(remainingMs(running, 21000), 30000);
  assert.equal(remainingMs(running, 999999), 0);
  const paused = { ...running, running: false, startedAt: null };
  assert.equal(elapsedMs(paused, 999999), 10000);
});

test('dayStats, streak, weekSeries and subjectTotals', () => {
  const done = (subject, secs, outcome = 'met') => ({ ...newBox({ title: 'x', subject }), status: 'done', actualSeconds: secs, outcome });
  const days = {
    '2026-11-01': { startTime: '09:00', boxes: [done('math', 1500)] },
    '2026-11-02': { startTime: '09:00', boxes: [done('math', 1500, 'partial'), done('bio', 3000)] },
    '2026-11-03': { startTime: '09:00', boxes: [newBox({ title: 'later' })] },
  };
  const s = dayStats(days['2026-11-02']);
  assert.equal(s.done, 2);
  assert.equal(s.focusSeconds, 4500);
  assert.equal(s.metRate, 0.5);
  assert.equal(dayStats(undefined).planned, 0);

  assert.equal(streak(days, '2026-11-03'), 2, 'today has nothing finished yet, so count from yesterday');
  assert.equal(streak(days, '2026-11-02'), 2);
  assert.equal(streak(days, '2026-11-05'), 0);

  const week = weekSeries(days, '2026-11-03');
  assert.equal(week.length, 7);
  assert.equal(week[6].key, '2026-11-03');
  assert.equal(week[5].minutes, 75);

  assert.deepEqual(subjectTotals(days, ['2026-11-01', '2026-11-02']), [
    { subject: 'math', seconds: 3000 }, { subject: 'bio', seconds: 3000 },
  ].sort((a, b) => b.seconds - a.seconds));
});

test('sanitizeState repairs junk instead of crashing', () => {
  assert.deepEqual(sanitizeState(null), defaultState());
  assert.deepEqual(sanitizeState('nope').inbox, []);

  const raw = JSON.parse(`{
    "settings": { "focusMinutes": 9999, "volume": 7, "theme": "neon", "dayStart": "25:00" },
    "inbox": [ { "id": "a", "title": "  Read  " }, { "id": "a", "title": "dup id" }, { "title": "" }, 42 ],
    "days": {
      "__proto__": { "boxes": [] },
      "2026-13-01": { "boxes": [] },
      "2026-11-03": { "startTime": "08:00", "boxes": [
        { "id": "b1", "title": "Box", "minutes": -5, "status": "weird", "outcome": "met", "actualSeconds": "x" },
        { "id": "b1", "title": "Same id" },
        { "title": "<img src=x onerror=alert(1)>" }
      ] }
    },
    "timer": { "phase": "focus", "running": true, "boxId": "missing", "dayKey": "2026-11-03", "durationMs": 60000, "startedAt": 5 }
  }`);
  const s = sanitizeState(raw);
  assert.equal(s.settings.focusMinutes, 240);
  assert.equal(s.settings.volume, 1, 'out-of-range volume is clamped');
  assert.equal(s.settings.theme, 'system');
  assert.equal(s.settings.dayStart, '09:00');
  assert.equal(s.inbox.length, 2);
  assert.notEqual(s.inbox[0].id, s.inbox[1].id);
  assert.deepEqual(Object.keys(s.days), ['2026-11-03']);
  assert.equal(Object.getPrototypeOf(s.days), Object.prototype);
  const boxes = s.days['2026-11-03'].boxes;
  assert.equal(boxes.length, 3);
  assert.equal(boxes[0].minutes, 1);
  assert.equal(boxes[0].status, 'todo');
  assert.equal(boxes[0].actualSeconds, 0);
  assert.notEqual(boxes[0].id, boxes[1].id);
  assert.equal(boxes[2].title, '<img src=x onerror=alert(1)>', 'kept as text; the UI never uses innerHTML for it');
  assert.equal(s.timer.phase, 'idle', 'timer pointing at a missing box is reset');
});

test('sanitizeState keeps a valid running timer', () => {
  const box = newBox({ title: 'Live', minutes: 25 });
  const raw = {
    days: { '2026-11-03': { startTime: '09:00', boxes: [box] } },
    timer: { phase: 'focus', running: true, ended: false, boxId: box.id, dayKey: '2026-11-03', durationMs: 1500000, accumulatedMs: 0, startedAt: 1000 },
  };
  const t = sanitizeState(raw).timer;
  assert.equal(t.phase, 'focus');
  assert.equal(t.running, true);
  assert.equal(t.startedAt, 1000);
});

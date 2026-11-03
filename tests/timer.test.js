import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../js/store.js';
import * as S from '../js/store.js';
import * as T from '../js/timer.js';
import { defaultState } from '../js/core.js';

const DAY = '2026-11-03';
const MIN = 60000;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 10, 3, 9, 0).getTime() });
  store.state = defaultState();
});

afterEach(() => {
  T.stop(); // clear the pending deadline so it cannot leak into the next test's clock
  mock.timers.reset();
});

const timer = () => store.state.timer;

test('a focus box stops at its length and then starts a short break', () => {
  const box = S.addBox(DAY, { title: 'Biology', minutes: 25 });
  T.startFocus(DAY, box.id);
  assert.equal(timer().phase, 'focus');
  assert.equal(timer().durationMs, 25 * MIN);

  mock.timers.tick(25 * MIN + 100);
  assert.equal(timer().ended, true, 'deadline handled by the one-shot timeout');
  assert.equal(timer().running, false);

  mock.timers.tick(10 * MIN); // the user takes a while to answer the reflection
  T.completeFocus('met', 'chapter done');
  const saved = S.findBox(DAY, box.id);
  assert.equal(saved.status, 'done');
  assert.equal(saved.outcome, 'met');
  assert.equal(saved.note, 'chapter done');
  assert.equal(saved.actualSeconds, 25 * 60, 'waiting time is not counted as focus');
  assert.equal(timer().phase, 'short');
  assert.equal(timer().durationMs, 5 * MIN);
});

test('paused time is not counted, and a restart resumes the unspent part', () => {
  const box = S.addBox(DAY, { title: 'Essay', minutes: 25 });
  T.startFocus(DAY, box.id);
  mock.timers.tick(10 * MIN);
  T.pause();
  mock.timers.tick(30 * MIN);
  T.resume();
  mock.timers.tick(5 * MIN);
  T.stop();
  assert.equal(S.findBox(DAY, box.id).actualSeconds, 15 * 60);
  assert.equal(S.findBox(DAY, box.id).status, 'todo');
  assert.equal(timer().phase, 'idle');

  T.startFocus(DAY, box.id);
  assert.equal(timer().durationMs, 10 * MIN);
});

test('a long break comes after every N finished boxes', () => {
  store.state.settings.longBreakEvery = 2;
  const a = S.addBox(DAY, { title: 'A', minutes: 25 });
  const b = S.addBox(DAY, { title: 'B', minutes: 25 });
  T.startFocus(DAY, a.id);
  mock.timers.tick(MIN);
  T.completeFocus('met');
  assert.equal(timer().phase, 'short');
  T.skipBreak();
  assert.equal(timer().phase, 'idle');
  T.startFocus(DAY, b.id);
  mock.timers.tick(MIN);
  T.completeFocus('partial');
  assert.equal(timer().phase, 'long');
  assert.equal(timer().durationMs, 15 * MIN);
});

test('skipping logs the time spent and does not start a break', () => {
  const box = S.addBox(DAY, { title: 'Chem', minutes: 25 });
  T.startFocus(DAY, box.id);
  mock.timers.tick(5 * MIN);
  T.skipFocus();
  assert.equal(S.findBox(DAY, box.id).status, 'skipped');
  assert.equal(S.findBox(DAY, box.id).actualSeconds, 300);
  assert.equal(timer().phase, 'idle');
  assert.equal(timer().suggest, null);
});

test('adding 5 minutes after time is up keeps the same box going', () => {
  const box = S.addBox(DAY, { title: 'Quiz', minutes: 1 });
  T.startFocus(DAY, box.id);
  mock.timers.tick(MIN + 100);
  assert.equal(timer().ended, true);
  T.extend(5);
  assert.equal(timer().running, true);
  mock.timers.tick(5 * MIN + 100);
  assert.equal(timer().ended, true);
  T.completeFocus('met');
  assert.equal(S.findBox(DAY, box.id).actualSeconds, 6 * 60);
});

test('with auto-start off, a break is suggested instead of started', () => {
  store.state.settings.autoStartBreaks = false;
  const box = S.addBox(DAY, { title: 'Notes', minutes: 25 });
  T.startFocus(DAY, box.id);
  mock.timers.tick(2 * MIN);
  T.completeFocus('missed');
  assert.equal(timer().phase, 'idle');
  assert.equal(timer().suggest, 'short');
  T.startSuggestedBreak();
  assert.equal(timer().phase, 'short');
  mock.timers.tick(5 * MIN + 100);
  assert.equal(timer().phase, 'idle', 'break ends on its own');
});

test('switching boxes keeps time already spent on the first one', () => {
  const a = S.addBox(DAY, { title: 'A', minutes: 25 });
  const b = S.addBox(DAY, { title: 'B', minutes: 25 });
  T.startFocus(DAY, a.id);
  mock.timers.tick(7 * MIN);
  T.startFocus(DAY, b.id);
  assert.equal(S.findBox(DAY, a.id).actualSeconds, 7 * 60);
  assert.equal(timer().boxId, b.id);
});

test('deleting the running box resets the timer', () => {
  const box = S.addBox(DAY, { title: 'Gone', minutes: 25 });
  T.startFocus(DAY, box.id);
  S.removeBox(DAY, box.id);
  assert.equal(timer().phase, 'idle');
  mock.timers.tick(30 * MIN);
  assert.equal(timer().phase, 'idle');
});

test('carry over moves untouched boxes and leaves worked ones as skipped', () => {
  const y = '2026-11-02';
  const fresh = S.addBox(y, { title: 'Untouched', minutes: 30 });
  const worked = S.addBox(y, { title: 'Half done', minutes: 30 });
  S.updateBox(y, worked.id, { actualSeconds: 600 });
  const n = S.carryOver(y, DAY);
  assert.equal(n, 2);
  assert.equal(S.findBox(y, fresh.id), null);
  assert.equal(S.findBox(y, worked.id).status, 'skipped');
  const today = S.getDay(DAY).boxes;
  assert.deepEqual(today.map((b) => [b.title, b.minutes]), [['Untouched', 30], ['Half done', 20]]);
});

test('starring is capped at three priorities', () => {
  const ids = ['one', 'two', 'three', 'four'].map((t) => S.addInbox({ title: t }).id);
  assert.ok(S.toggleStar(ids[0]));
  assert.ok(S.toggleStar(ids[1]));
  assert.ok(S.toggleStar(ids[2]));
  assert.equal(S.toggleStar(ids[3]), false);
  const box = S.inboxToBox(ids[1], DAY);
  assert.equal(box.title, 'two');
  assert.equal(store.state.inbox.length, 3);
});

test('starting another box after time is up finishes the first one', () => {
  const a = S.addBox(DAY, { title: 'A', minutes: 1 });
  const b = S.addBox(DAY, { title: 'B', minutes: 25 });
  T.startFocus(DAY, a.id);
  mock.timers.tick(MIN + 100);
  assert.equal(timer().ended, true);
  T.startFocus(DAY, b.id);
  assert.equal(S.findBox(DAY, a.id).status, 'done');
  assert.equal(S.findBox(DAY, a.id).actualSeconds, 60);
  assert.equal(timer().boxId, b.id);
});

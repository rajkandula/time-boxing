# Timebox — Focused Study Planner

**Live app: https://rajkandula.github.io/time-boxing/**

Timeboxing means giving each task a fixed block of time, working on it with full focus until the time is up, then
stopping and reviewing. Timebox turns that method into a simple daily routine for studying:

1. **Brain dump** – write down everything you need to study.
2. **Top 3** – star the three tasks that matter most today.
3. **Box them** – put tasks on today's timeline with a length and a goal (“done” looks like…).
4. **Focus** – run one box at a time with a full-screen countdown, then take a break.
5. **Review** – note how each box went and watch your focus time, goals met and streak add up.

## Features

- Day planner with a live timeline (start times, breaks, projected finish), drag to reorder, and carry-over of
  unfinished boxes from earlier days.
- Focus timer that never drifts: it runs on timestamps, survives reloads, sleeping laptops and background tabs, and
  picks up where you left off.
- Pomodoro-style breaks with a long break every few boxes; presets for 25/5, 50/10 and 90/20.
- Reflection after every box (goal met / partly / not yet + a note), so the review shows what you actually did.
- Review page: focus time vs. your daily goal, boxes finished, goal hit rate, streak, last-7-days chart and time by
  subject.
- Chime, optional system notifications, and a screen wake lock while the timer runs.
- Quick add syntax: `Essay outline #english 50m` sets the subject and length in one line.
- Keyboard shortcuts: <kbd>Space</kbd> start/pause, <kbd>N</kbd> new task, <kbd>B</kbd> new box, <kbd>F</kbd> finish,
  <kbd>E</kbd> +5 min, <kbd>S</kbd> skip, <kbd>1</kbd>–<kbd>3</kbd> switch views, <kbd>?</kbd> help.
- Installable, works offline, light and dark themes, works on phones.

## Your data

There is no account and no server. Everything is saved in your browser's local storage on your device and never
leaves it. In **Settings → Your data** you can export a backup file, import it on another device, or clear
everything.

## Run locally

No build step. Serve the folder with any static file server:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. Run the unit tests with Node 20 or newer:

```bash
node --test
```

## Deploy

The site is plain static files, published by GitHub Pages straight from the `main` branch (root folder).
Push to `main` and Pages redeploys in about a minute.

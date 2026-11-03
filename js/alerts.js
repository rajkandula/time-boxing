// Chime, system notifications, vibration and the screen wake lock.

let ctx = null;

// Browsers only allow audio after a user gesture, so call this from a click handler.
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

// A soft bell: rising notes when a focus box ends, falling notes when a break ends.
export function chime(kind = 'focus', volume = 0.6) {
  if (!ctx || volume <= 0) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime + 0.03;
  const notes = kind === 'break' ? [783.99, 659.25, 523.25] : [523.25, 659.25, 783.99, 1046.5];
  const master = ctx.createGain();
  master.gain.value = Math.min(1, volume) * 0.35;
  master.connect(ctx.destination);
  notes.forEach((freq, i) => {
    const start = t0 + i * 0.16;
    [[1, 1], [2.01, 0.25]].forEach(([mult, peak]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 1.5);
    });
  });
}

export function vibrate() {
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch { /* not supported */ }
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// Android Chrome only shows notifications through the service worker, so try that first.
export async function notify(title, body) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const options = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'timebox', renotify: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch { /* fall back below */ }
  try {
    new Notification(title, options);
  } catch { /* not allowed here */ }
}

let lock = null;
let pending = null;

// Keeps the screen on while a timer runs (useful when studying from a phone or tablet).
// The browser drops the lock whenever the page is hidden, so call this again on return.
export async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  if (pending) await pending.catch(() => {});
  try {
    if (on && !lock && document.visibilityState === 'visible') {
      pending = navigator.wakeLock.request('screen');
      lock = await pending;
      lock.addEventListener('release', () => {
        lock = null;
      });
    } else if (!on && lock) {
      const current = lock;
      lock = null;
      await current.release();
    }
  } catch {
    lock = null;
  } finally {
    pending = null;
  }
}

// Small DOM helpers. User text always goes in through textContent, never innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  play: '<path d="M7.5 4.8v14.4L19 12z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  skip: '<path d="M5 5.5l9.5 6.5L5 18.5zM19 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.3M3.5 3.5v4.8h4.8"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.75 1-5.8L3.5 9.7l5.9-.9z"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.2A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17z"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7M12 17.2h.01"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g>',
  coffee: '<path d="M5 9h11v4.5A4.5 4.5 0 0 1 11.5 18h-2A4.5 4.5 0 0 1 5 13.5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5V6M11.5 3.5V6M4 21h13"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 21h4"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.6 3-5.4 3.6-8.8 2.6 1.5 3.4 3.8 3.3 5.4 1.1-.5 1.8-1.7 2-3 1.7 1.6 4.1 4 4.1 6.6 0 3.5-2.6 6-6.5 6z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  install: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/>',
  carry: '<path d="M4 12h12M12 7l5 5-5 5M20 5v14"/>',
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ic');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

// Replaces <i data-icon="name"> placeholders in static markup.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) {
    el.replaceWith(icon(el.dataset.icon, Number(el.dataset.size) || 18));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;

export function toast(message, { action, onAction, duration = 4500 } = {}) {
  const el = $('#toast');
  const hide = () => el.classList.remove('show');
  el.replaceChildren(h('span', { class: 'toast-msg' }, message));
  if (action) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-action',
      onclick: () => {
        hide();
        onAction?.();
      },
    }, action));
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, duration);
}

// Screen-reader announcement for events that happen without a click (timer ends).
export function announce(message) {
  const el = $('#announcer');
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

export function openDialog(dlg) {
  if (!dlg.open) dlg.showModal();
}

export function closeDialog(dlg, value = '') {
  if (dlg.open) dlg.close(value);
}

// Clicking the dimmed backdrop closes a dialog. The dialog has no padding of its own,
// so a click whose target is the <dialog> itself can only be on the backdrop.
export function enableBackdropClose(dlg) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close('cancel');
  });
}

export function confirmDialog(message, { title = 'Are you sure?', confirmText = 'Confirm', danger = false } = {}) {
  const dlg = $('#dlg-confirm');
  $('#confirm-title', dlg).textContent = title;
  $('#confirm-message', dlg).textContent = message;
  const ok = $('#confirm-ok', dlg);
  ok.textContent = confirmText;
  ok.classList.toggle('btn-danger', danger);
  ok.classList.toggle('btn-primary', !danger);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = '';
    openDialog(dlg);
    ok.focus();
  });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

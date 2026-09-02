// Small shared helpers.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k.startsWith('data')) node.setAttribute(k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

export const uid = (p = 'e') => p + Math.random().toString(36).slice(2, 8);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}

/** `01JAN2026` — the date format used throughout, per the spec. */
export function stamp(d = new Date()) {
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return String(d.getDate()).padStart(2, '0') + M[d.getMonth()] + d.getFullYear();
}

export function rgbToHex(value) {
  if (!value) return '';
  const v = value.trim();
  if (v.startsWith('#')) return v.length === 4
    ? '#' + [...v.slice(1)].map(c => c + c).join('') : v.toLowerCase();
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) return v;
  const [r, g, b, a] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (a === 0) return '';
  return '#' + [r, g, b].map(n => clamp(n | 0, 0, 255).toString(16).padStart(2, '0')).join('');
}

/** Readable ink for text sitting on `bg`, so a user-chosen fill stays legible
 *  in either theme. Returns null when the background is see-through. */
export function contrastOn(bg) {
  const hex = rgbToHex(bg);
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.36 ? '#1c1b19' : '#f2f0ec';
}

let toastTimer;
export function toast(msg, bad = false) {
  const box = $('#toast');
  box.textContent = msg;
  box.classList.toggle('bad', bad);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, bad ? 5000 : 2200);
}

export const dirOf  = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
export const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
export const stemOf = p => baseOf(p).replace(/\.md$/i, '');
export const join   = (a, b) => (a ? a + '/' : '') + b;

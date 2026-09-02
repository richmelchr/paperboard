// One shared context menu, used by the canvas, the editors and the tree.

import { $, el } from './util.js';

let box, closer;

export function showMenu(x, y, items) {
  box = box || $('#ctx');
  box.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { box.append(el('hr')); continue; }
    if (it.colors) {
      box.append(el('div', { class: 'row-colors' }, it.colors.map(c =>
        el('button', { style: { background: c }, title: c,
          onclick: () => { hideMenu(); it.pick(c); } }))));
      continue;
    }
    box.append(el('button', { onclick: () => { hideMenu(); it.run(); } },
      el('span', {}, it.label),
      it.key ? el('span', { class: 'k' }, it.key) : null));
  }
  box.hidden = false;
  const r = box.getBoundingClientRect();
  box.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  box.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';

  closer = ev => { if (!box.contains(ev.target)) hideMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', closer, true);
    document.addEventListener('keydown', escClose, true);
  }, 0);
}

const escClose = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); hideMenu(); } };

export function hideMenu() {
  if (!box) return;
  box.hidden = true;
  document.removeEventListener('pointerdown', closer, true);
  document.removeEventListener('keydown', escClose, true);
}

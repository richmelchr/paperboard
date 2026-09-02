// ⌘K — jump to a note or run a command.

import { $, el } from './util.js';
import { allNotes } from './tree.js';

let commands = [], onPick = () => {}, items = [], cursor = 0;

export function mount(opts) {
  onPick = opts.onOpen;
  commands = opts.commands;
  const input = $('#palette-input');
  input.addEventListener('input', () => refill(input.value));
  input.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') return close();
    if (ev.key === 'ArrowDown') { cursor = Math.min(cursor + 1, items.length - 1); paint(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { cursor = Math.max(cursor - 1, 0); paint(); ev.preventDefault(); }
    if (ev.key === 'Enter') { ev.preventDefault(); run(items[cursor]); }
  });
  document.addEventListener('pointerdown', ev => {
    const box = $('#palette');
    if (!box.hidden && !box.contains(ev.target)) close();
  }, true);
}

export function open() {
  const box = $('#palette');
  box.hidden = false;
  const input = $('#palette-input');
  input.value = '';
  refill('');
  input.focus();
}

export function close() { $('#palette').hidden = true; }
export const isOpen = () => !$('#palette').hidden;

function refill(q) {
  const query = q.toLowerCase().trim();
  const notes = allNotes().map(n => ({
    label: n.title || n.name, where: n.folder || 'Notes', run: () => onPick(n.path),
    hay: (n.title + ' ' + n.name + ' ' + n.folder).toLowerCase(),
  }));
  const cmds = commands.map(c => ({ ...c, where: c.key || 'command', hay: c.label.toLowerCase() }));
  const pool = query ? [...notes, ...cmds] : [...cmds, ...notes];
  items = pool.filter(i => !query || query.split(/\s+/).every(t => i.hay.includes(t))).slice(0, 40);
  cursor = 0;
  paint();
}

function paint() {
  const list = $('#palette-list');
  list.innerHTML = '';
  items.forEach((it, i) => list.append(el('li', {
    class: i === cursor ? 'on' : '',
    onpointerenter: () => { cursor = i; paint(); },
    onclick: () => run(it),
  }, el('span', {}, it.label), el('span', { class: 'where' }, it.where))));
  list.children[cursor]?.scrollIntoView({ block: 'nearest' });
}

function run(item) {
  if (!item) return;
  close();
  item.run();
}

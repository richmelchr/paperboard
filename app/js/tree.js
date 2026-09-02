// The sidebar: the notes folder rendered as a tree, with OneNote-style folder
// colours, inline rename, drag-to-move, and search filtering.

import { $, el, toast, dirOf, baseOf, join } from './util.js';
import { api } from './api.js';
import { showMenu } from './menu.js';

let root = null;
let palette = [];
let active = null;
let filterSet = null;        // null = no search; otherwise the set of visible notes
let snippets = {};
let terms = [];
let onOpen = () => {};
let onStructure = () => {};

const expanded = new Set(JSON.parse(localStorage.getItem('wb:expanded') || '["" ]'));
const saveExpanded = () => localStorage.setItem('wb:expanded', JSON.stringify([...expanded]));

export function allNotes() {
  const out = [];
  (function walk(node) {
    out.push(...node.notes.map(n => ({ ...n, folder: node.path })));
    node.folders.forEach(walk);
  })(root || { path: '', notes: [], folders: [] });
  return out;
}

export function findByName(name) {
  const key = String(name).toLowerCase().trim();
  return allNotes().find(n => n.name.toLowerCase() === key ||
                              (n.title || '').toLowerCase() === key) || null;
}

export function setActive(path) {
  active = path;
  for (const d of dirOf(path).split('/').filter(Boolean).reduce(
      (acc, part) => [...acc, join(acc[acc.length - 1] || '', part)], [''])) expanded.add(d);
  saveExpanded();
  paint();
}

export async function refresh() {
  const data = await api.tree();
  root = data.tree;
  palette = data.palette;
  paint();
}

// ── filtering ─────────────────────────────────────────────────────────────

export function applyFilter(matches, matchTerms = []) {
  if (!matches) { filterSet = null; snippets = {}; terms = []; }
  else {
    filterSet = new Set(matches.map(m => m.path));
    snippets = Object.fromEntries(matches.map(m => [m.path, m.snippet]));
    terms = matchTerms.filter(Boolean);
  }
  paint();
}

const escapeHtml = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Mark the search terms inside a snippet. The snippet is server-generated
 *  plain text, so building markup from it is safe. */
function markTerms(text) {
  let html = escapeHtml(text);
  for (const term of terms) {
    const needle = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(?![^<]*>)(${needle})`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

const folderVisible = node =>
  !filterSet || node.notes.some(n => filterSet.has(n.path)) || node.folders.some(folderVisible);

// ── painting ──────────────────────────────────────────────────────────────

function paint() {
  const host = $('#tree');
  if (!root) return;
  host.innerHTML = '';
  host.append(...children(root));
}

function children(node) {
  const out = [];
  for (const f of node.folders) {
    if (!folderVisible(f)) continue;
    out.push(folderRow(f));
    const open = expanded.has(f.path) || !!filterSet;
    if (open) out.push(el('div', { class: 'kids' }, children(f)));
  }
  for (const n of node.notes) {
    if (filterSet && !filterSet.has(n.path)) continue;
    out.push(noteRow(n));
  }
  return out;
}

function folderRow(f) {
  const open = expanded.has(f.path) || !!filterSet;
  const row = el('div', {
    class: 'row folder', draggable: 'true', 'data-path': f.path, 'data-kind': 'folder',
    onclick: () => { open ? expanded.delete(f.path) : expanded.add(f.path); saveExpanded(); paint(); },
    oncontextmenu: ev => { ev.preventDefault(); folderMenu(ev, f); },
  },
    el('span', { class: 'twist' }, open ? '▾' : '▸'),
    el('span', { class: 'chip', style: { background: f.color } }),
    el('span', { class: 'label' }, f.name));
  wireDrag(row, f.path, 'folder');
  return row;
}

function noteRow(n) {
  const row = el('div', {
    class: 'row note' + (n.path === active ? ' active' : ''),
    draggable: 'true', 'data-path': n.path, 'data-kind': 'note',
    title: n.path + (n.modified ? `\nedited ${n.modified}` : ''),
    onclick: () => onOpen(n.path),
    oncontextmenu: ev => { ev.preventDefault(); noteMenu(ev, n); },
  },
    el('span', { class: 'twist' }),
    el('span', { class: 'pagemark' }, '▤'),
    el('span', { class: 'label' }, n.title || n.name),
    snippets[n.path]
      ? el('span', { class: 'snip', html: markTerms(snippets[n.path]) })
      : null);
  wireDrag(row, n.path, 'note');
  return row;
}

// ── drag to move ──────────────────────────────────────────────────────────

function wireDrag(row, path, kind) {
  row.addEventListener('dragstart', ev => {
    ev.stopPropagation();
    ev.dataTransfer.setData('text/wb-path', path);
    ev.dataTransfer.effectAllowed = 'move';
  });
  if (kind !== 'folder') return;
  row.addEventListener('dragover', ev => {
    if (!ev.dataTransfer.types.includes('text/wb-path')) return;
    ev.preventDefault(); row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', async ev => {
    ev.preventDefault(); ev.stopPropagation();
    row.classList.remove('drop-target');
    const from = ev.dataTransfer.getData('text/wb-path');
    if (!from || from === path || path.startsWith(from + '/')) return;
    const to = join(path, baseOf(from));
    const res = await api.rename(from, to).catch(e => toast(e.message, true));
    if (res) { await refresh(); onStructure(); if (active === from) onOpen(res.path); }
  });
}

// ── menus ─────────────────────────────────────────────────────────────────

function folderMenu(ev, f) {
  showMenu(ev.clientX, ev.clientY, [
    { label: 'New note here', run: () => newNote(f.path) },
    { label: 'New folder inside', run: () => newFolder(f.path) },
    '-',
    { label: 'Rename…', run: () => rename(f.path) },
    { colors: palette, pick: async c => { await api.setColor(f.path, c); refresh(); } },
    '-',
    { label: 'Move to trash', run: () => trash(f.path, `folder “${f.name}” and everything in it`) },
  ]);
}

function noteMenu(ev, n) {
  showMenu(ev.clientX, ev.clientY, [
    { label: 'Open', run: () => onOpen(n.path) },
    { label: 'Rename…', run: () => rename(n.path) },
    { label: 'Copy link', run: () => {
        navigator.clipboard.writeText(`[[${n.name}]]`);
        toast(`Copied [[${n.name}]]`);
      } },
    '-',
    { label: 'New note beside', run: () => newNote(dirOf(n.path)) },
    { label: 'Version history…', run: () => history(ev, n) },
    '-',
    { label: 'Move to trash', run: () => trash(n.path, `“${n.title || n.name}”`) },
  ]);
}

// ── actions ───────────────────────────────────────────────────────────────

export async function newNote(folder = dirOf(active || '')) {
  const res = await api.create(join(folder, 'New note.md'), 'note');
  await refresh();
  onStructure();
  onOpen(res.path);
  setTimeout(() => rename(res.path), 60);
  return res.path;
}

export async function newFolder(parent = dirOf(active || '')) {
  const res = await api.create(join(parent, 'New folder'), 'folder');
  expanded.add(res.path); saveExpanded();
  await refresh(); onStructure();
  rename(res.path);
}

export function rename(path) {
  const row = $(`.row[data-path="${CSS.escape(path)}"]`);
  if (!row) return;
  const label = row.querySelector('.label');
  const before = label.textContent;
  label.contentEditable = 'plaintext-only';
  label.focus();
  const r = document.createRange();
  r.selectNodeContents(label);
  getSelection().removeAllRanges(); getSelection().addRange(r);

  const finish = async (keep) => {
    label.contentEditable = 'false';
    const name = label.textContent.trim().replace(/[\/\\]/g, '-');
    if (!keep || !name || name === before) { paint(); return; }
    const isNote = row.dataset.kind === 'note';
    const to = join(dirOf(path), isNote ? name + '.md' : name);
    try {
      const res = await api.rename(path, to);
      await refresh(); onStructure();
      if (active === path && isNote) onOpen(res.path);
      else if (active?.startsWith(path + '/')) onOpen(active.replace(path, res.path));
    } catch (e) { toast(e.message, true); paint(); }
  };
  label.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); label.blur(); }
    if (ev.key === 'Escape') { label.textContent = before; label.blur(); }
  });
  label.addEventListener('blur', () => finish(true), { once: true });
}

async function history(ev, n) {
  let versions;
  try { versions = (await api.history(n.path)).versions; }
  catch (e) { return toast(e.message, true); }
  if (!versions.length) {
    return toast('No earlier versions yet — one is kept every 10 minutes of editing.');
  }
  showMenu(ev.clientX, ev.clientY, versions.slice(0, 20).map(v => ({
    label: `${v.date}  ${v.time}`,
    key: (v.bytes / 1024).toFixed(1) + ' KB',
    run: async () => {
      if (!confirm(`Restore “${n.title || n.name}” to ${v.date} ${v.time}?\n\n` +
                   'The current version is kept in history first.')) return;
      await api.restore(n.path, v.at);
      await refresh();
      onOpen(n.path);
      toast('Restored ' + v.date + ' ' + v.time);
    },
  })));
}

async function trash(path, what) {
  if (!confirm(`Move ${what} to notes/.trash?\n\nNothing is erased — you can drag it back out.`)) return;
  await api.remove(path);
  await refresh(); onStructure();
  if (active === path || active?.startsWith(path + '/')) {
    const first = allNotes()[0];
    if (first) onOpen(first.path);
  }
  toast('Moved to .trash');
}

export function mount(opts) {
  onOpen = opts.onOpen;
  onStructure = opts.onStructure || (() => {});
  $('#new-note').onclick = () => newNote();
  $('#new-folder').onclick = () => newFolder();
  $('#tree').addEventListener('contextmenu', ev => {
    if (ev.target.closest('.row')) return;
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, [
      { label: 'New note', run: () => newNote('') },
      { label: 'New folder', run: () => newFolder('') },
    ]);
  });
  $('#tree').addEventListener('dragover', ev => {
    if (ev.dataTransfer.types.includes('text/wb-path')) ev.preventDefault();
  });
  $('#tree').addEventListener('drop', async ev => {
    if (ev.target.closest('.row')) return;
    ev.preventDefault();
    const from = ev.dataTransfer.getData('text/wb-path');
    if (!from || !dirOf(from)) return;
    const res = await api.rename(from, baseOf(from)).catch(e => toast(e.message, true));
    if (res) { await refresh(); onStructure(); if (active === from) onOpen(res.path); }
  });
}

// Wiring: theme, note lifecycle, header, search, shortcuts, image handling.

import { $, $$, el, debounce, toast, stemOf, dirOf } from './util.js';
import { api } from './api.js';
import { store, on, open as openNote, saveNow, undo, redo, commit,
         startWatching } from './store.js';
import * as tree from './tree.js';
import * as cv from './canvas.js';
import * as toolbar from './toolbar.js';
import * as rt from './richtext.js';
import * as palette from './palette.js';
import * as minimap from './minimap.js';
import * as exporter from './export.js';

// ── theme ─────────────────────────────────────────────────────────────────

const setTheme = name => {
  document.documentElement.dataset.theme = name;
  localStorage.setItem('wb:theme', name);
  minimap.draw();
};
const toggleTheme = () =>
  setTheme(document.documentElement.dataset.theme === 'paper' ? 'darcula' : 'paper');

setTheme(localStorage.getItem('wb:theme') || 'paper');
$('#theme-toggle').onclick = toggleTheme;

// ── header ────────────────────────────────────────────────────────────────

let backlinks = {};

function paintHeader() {
  const m = store.doc.meta;
  const title = $('#note-title');
  if (title !== document.activeElement && title.textContent !== m.title) title.textContent = m.title;
  $('#meta-created').textContent = 'created ' + m.created;
  $('#meta-modified').textContent = 'edited ' + m.modified;
  $('#meta-path').textContent = store.path || '';
  document.title = (m.title || 'Paperboard') + ' — Paperboard';

  const back = backlinks[store.path] || [];
  const host = $('#backlinks');
  host.innerHTML = '';
  if (back.length) {
    host.append('linked from ');
    back.forEach((p, i) => {
      if (i) host.append(', ');
      host.append(el('a', { href: '#', onclick: ev => { ev.preventDefault(); go(p); } }, stemOf(p)));
    });
  }
}

$('#note-title').addEventListener('input', () => {
  store.doc.meta.title = $('#note-title').textContent.trim() || 'Untitled';
  commit({ coalesce: true });
});
$('#note-title').addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Enter') { ev.preventDefault(); $('#note-title').blur(); }
});
$('#note-title').addEventListener('blur', () => { commit(); refreshLinks(); });

const refreshLinks = debounce(async () => {
  try { backlinks = (await api.links()).backlinks; paintHeader(); } catch { /* ignore */ }
}, 400);

// ── opening notes ─────────────────────────────────────────────────────────

async function go(path) {
  try {
    await openNote(path);
    tree.setActive(path);
    refreshLinks();
  } catch (e) { toast(e.message, true); }
}

rt.setNoteOpener(name => {
  const hit = tree.findByName(name);
  if (hit) go(hit.path);
  else if (confirm(`No note called “${name}”. Create it?`)) {
    api.create((dirOf(store.path || '') ? dirOf(store.path) + '/' : '') + name + '.md', 'note')
      .then(async r => { await tree.refresh(); go(r.path); });
  }
});

// ── live search highlighting ──────────────────────────────────────────────
//
// Uses the CSS Custom Highlight API, so matches are painted without touching
// the DOM — nothing to strip before saving, and it survives typing.

let searchTerms = [];

export function paintMatches() {
  if (!window.CSS?.highlights) return;
  CSS.highlights.delete('wb-search');
  if (!searchTerms.length) return;

  const ranges = [];
  for (const host of $$('.rt, .note-title')) {
    const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const hay = node.data.toLowerCase();
      for (const term of searchTerms) {
        for (let i = hay.indexOf(term); i !== -1; i = hay.indexOf(term, i + term.length)) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + term.length);
          ranges.push(r);
        }
      }
    }
  }
  if (ranges.length) CSS.highlights.set('wb-search', new Highlight(...ranges));
}

const repaintMatches = debounce(paintMatches, 90);
document.addEventListener('input', () => { if (searchTerms.length) repaintMatches(); }, true);

// ── search ────────────────────────────────────────────────────────────────

const runSearch = debounce(async q => {
  const status = $('#search-status');
  if (!q.trim()) {
    tree.applyFilter(null);
    searchTerms = [];
    paintMatches();
    status.hidden = true;
    $('#search-clear').hidden = true;
    return;
  }
  $('#search-clear').hidden = false;
  try {
    const { matches, terms } = await api.search(q);
    tree.applyFilter(matches, terms);
    searchTerms = terms.filter(Boolean);
    paintMatches();
    status.hidden = false;
    status.classList.remove('bad');
    const hits = CSS.highlights?.get('wb-search')?.size ?? 0;
    status.textContent = `${matches.length} note${matches.length === 1 ? '' : 's'} match` +
                         (hits ? ` · ${hits} here` : '');
  } catch (e) {
    status.hidden = false; status.classList.add('bad'); status.textContent = e.message;
  }
}, 180);

$('#search').addEventListener('input', e => runSearch(e.target.value));
$('#search').addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Escape') { ev.target.value = ''; runSearch(''); ev.target.blur(); }
  if (ev.key === 'Enter') {
    const first = $('#tree .row.note');
    if (first) go(first.dataset.path);
  }
});
$('#search-clear').onclick = () => { $('#search').value = ''; runSearch(''); };

// ── images: paste and drop ────────────────────────────────────────────────

document.addEventListener('paste', ev => {
  const file = [...(ev.clipboardData?.items || [])]
    .find(i => i.type.startsWith('image/'))?.getAsFile();
  if (!file) return;
  ev.preventDefault();
  cv.placeImage(file).catch(e => toast(e.message, true));
}, true);

const stage = $('#stage');
stage.addEventListener('dragover', ev => {
  if ([...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }
});
stage.addEventListener('drop', async ev => {
  const files = [...(ev.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  ev.preventDefault();
  const at = cv.toWorld(ev.clientX, ev.clientY);
  for (const [i, f] of files.entries())
    await cv.placeImage(f, { x: at.x + i * 24, y: at.y + i * 24 }).catch(e => toast(e.message, true));
});

// ── keyboard ──────────────────────────────────────────────────────────────

const TOOL_KEYS = { v: 'select', t: 'text', p: 'pen', r: 'box', l: 'line', h: 'pan' };

window.addEventListener('keydown', ev => {
  const mod = ev.metaKey || ev.ctrlKey;
  const typing = cv.isTyping();
  const key = ev.key.toLowerCase();

  if (mod && key === 's') { ev.preventDefault(); saveNow().then(() => toast('Saved')); return; }
  if (mod && key === 'z') {
    ev.preventDefault();
    (ev.shiftKey ? redo : undo)();
    toolbar.syncState();
    return;
  }
  if (mod && key === 'y') { ev.preventDefault(); redo(); toolbar.syncState(); return; }
  if (mod && key === 'n') { ev.preventDefault(); ev.shiftKey ? tree.newFolder() : tree.newNote(); return; }
  if (mod && key === 'f') { ev.preventDefault(); $('#search').select(); return; }
  if (mod && ev.shiftKey && key === 'd') { ev.preventDefault(); toggleTheme(); return; }
  if (mod && key === 'k') {
    ev.preventDefault();
    if (typing && rt.activeEditor()) {
      rt.saveRange();
      const url = prompt('Link URL', 'https://');
      if (url) rt.makeLink(url);
    } else palette.open();
    return;
  }
  if (mod && key === 'p') {
    ev.preventDefault();
    ev.shiftKey ? exporter.exportPdf() : palette.open();
    return;
  }
  if (mod && key === '\\') { ev.preventDefault(); rt.clearFormatting(); toolbar.syncState(); return; }
  if (mod && key === '0') { ev.preventDefault(); cv.setZoom(1); return; }
  if (mod && key === '1') { ev.preventDefault(); cv.fitToContent(); return; }
  if (mod && key === 'd' && !typing) { ev.preventDefault(); cv.duplicateSelected(); return; }
  if (mod && ['b', 'i', 'u'].includes(key) && typing) {
    ev.preventDefault();
    rt.exec({ b: 'bold', i: 'italic', u: 'underline' }[key]);
    toolbar.syncState();
    return;
  }

  if (typing) return;

  if (ev.key === 'Escape') { cv.clearSelection(); palette.close(); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); cv.removeSelected(); return; }
  if (!mod && TOOL_KEYS[key]) { cv.setTool(TOOL_KEYS[key]); return; }
  if (ev.key.startsWith('Arrow')) {
    const step = ev.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (d && cv.selected().length) {
      ev.preventDefault();
      for (const e of cv.selected()) { e.x += d[0]; e.y += d[1]; }
      cv.render(); commit();
    }
  }
});

// ── canvas context menu ───────────────────────────────────────────────────

import { showMenu } from './menu.js';
stage.addEventListener('contextmenu', ev => {
  if (ev.target.closest('.rt')) return;                 // richtext has its own
  ev.preventDefault();
  const node = ev.target.closest('.el') || ev.target.closest('path.hit');
  const id = node?.dataset?.id;
  if (id && !cv.selection.has(id)) cv.select(id);
  const some = cv.selected().length;
  const at = cv.toWorld(ev.clientX, ev.clientY);
  showMenu(ev.clientX, ev.clientY, [
    { label: 'New text box here', run: () => cv.createText(at.x, at.y) },
    some && { label: 'Duplicate', key: '⌘D', run: () => cv.duplicateSelected() },
    some && { label: 'Bring to front', run: () => {
        const sel = cv.selected();
        store.doc.elements = [...store.doc.elements.filter(e => !sel.includes(e)), ...sel];
        cv.render(); commit(); } },
    some && { label: 'Send to back', run: () => {
        const sel = cv.selected();
        store.doc.elements = [...sel, ...store.doc.elements.filter(e => !sel.includes(e))];
        cv.render(); commit(); } },
    some && '-',
    some && { label: 'Delete', key: '⌫', run: () => cv.removeSelected() },
    '-',
    { label: 'Fit to content', key: '⌘1', run: () => cv.fitToContent() },
    { label: 'Reset zoom', key: '⌘0', run: () => cv.setZoom(1) },
  ].filter(Boolean));
});

// ── splitter ──────────────────────────────────────────────────────────────

$('#splitter').addEventListener('pointerdown', ev => {
  ev.preventDefault();
  const side = $('#sidebar');
  const w0 = side.offsetWidth;
  const move = m => { side.style.width = Math.max(180, Math.min(620, w0 + m.clientX - ev.clientX)) + 'px'; };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    localStorage.setItem('wb:sidebar', side.style.width);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
const savedWidth = localStorage.getItem('wb:sidebar');
if (savedWidth) $('#sidebar').style.width = savedWidth;

// ── boot ──────────────────────────────────────────────────────────────────

on('load', () => { paintHeader(); toolbar.syncState(); minimap.draw(); repaintMatches(); });
on('state', () => {
  $('#save-state').textContent = store.dirty ? 'saving…' : 'saved';
  $('#save-state').classList.toggle('dirty', store.dirty);
  paintHeader();
  toolbar.syncState();
});
on('saved', () => refreshLinks());

document.addEventListener('selectionchange', debounce(() => toolbar.syncState(), 60));

cv.mount({ onChange: () => { minimap.draw(); toolbar.syncState(); } });
minimap.mount();
toolbar.mount();
tree.mount({ onOpen: go, onStructure: () => refreshLinks() });
palette.mount({
  onOpen: go,
  commands: [
    { label: 'New note', key: '⌘N', run: () => tree.newNote() },
    { label: 'New folder', key: '⇧⌘N', run: () => tree.newFolder() },
    { label: 'Toggle dark mode', key: '⇧⌘D', run: toggleTheme },
    { label: 'Fit to content', key: '⌘1', run: () => cv.fitToContent() },
    { label: 'Reset zoom', key: '⌘0', run: () => cv.setZoom(1) },
    { label: 'Save now', key: '⌘S', run: () => saveNow() },
    { label: 'Search notes', key: '⌘F', run: () => $('#search').select() },
    { label: 'Clear formatting', key: '⌘\\', run: () => rt.clearFormatting() },
    { label: 'Export as PNG', run: () => exporter.exportPng(2) },
    { label: 'Export as SVG', run: () => exporter.exportSvg() },
    { label: 'Print / save PDF', key: '⇧⌘P', run: () => exporter.exportPdf() },
    { label: 'Rectangle tool', key: 'R', run: () => { cv.style.shape = 'rect'; cv.setTool('box'); } },
    { label: 'Ellipse tool', run: () => { cv.style.shape = 'ellipse'; cv.setTool('box'); } },
    { label: 'Sticky note tool', run: () => { cv.style.shape = 'sticky'; cv.setTool('box'); } },
    { label: 'Draw tool', key: 'P', run: () => cv.setTool('pen') },
    { label: 'Box tool', key: 'R', run: () => cv.setTool('box') },
    { label: 'Connector tool', key: 'L', run: () => cv.setTool('line') },
  ],
});

// Handy from the browser console: wb.store.doc, wb.canvas.selected(), …
window.wb = { store, canvas: cv, tree, richtext: rt, saveNow, go };

(async function boot() {
  await tree.refresh();
  const notes = tree.allNotes();
  const last = localStorage.getItem('wb:last');
  const start = notes.find(n => n.path === last) || notes[0];
  if (start) await go(start.path);
  else {
    const res = await api.create('Welcome.md', 'note');
    await tree.refresh();
    await go(res.path);
  }
  startWatching(() => tree.refresh().then(() => tree.setActive(store.path)));
})();

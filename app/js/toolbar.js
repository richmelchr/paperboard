// The toolbar: tools, fonts, text formatting, colours, tables, shape styling,
// undo/redo and zoom.

import { $, $$, el, toast, debounce } from './util.js';
import * as rt from './richtext.js';
import * as cv from './canvas.js';
import * as exporter from './export.js';
import { newTable } from './table.js';
import { showMenu } from './menu.js';
import { store, commit, undo, redo, canUndo, canRedo } from './store.js';

const SWATCHES = [
  '#2f2b26', '#6f665c', '#b8443a', '#d8574b', '#e08a2e', '#d9b52c', '#5aa552', '#2f8f7d',
  '#3d9aa8', '#4a7fd4', '#3b6ea5', '#8a63c9', '#c05a9c', '#8b5e34', '#9aa0a6', '#ffffff',
  '#ffe479', '#ffd0a8', '#ffc9c2', '#e6d6ff', '#cfe4ff', '#c8f0c1', '#f4f0e6', '#000000',
];

let pop, popOwner = null;

// ── colour popover ────────────────────────────────────────────────────────

function openColorPop(btn, current, pick, { none = false } = {}) {
  pop = pop || $('#color-pop');
  if (popOwner === btn && !pop.hidden) { closePop(); return; }
  popOwner = btn;
  const grid = pop.querySelector('.swatches');
  grid.innerHTML = '';
  for (const c of SWATCHES) {
    grid.append(el('button', {
      style: { background: c }, title: c,
      onclick: () => { closePop(); pick(c); },
    }));
  }
  const custom = $('#color-custom');
  custom.value = /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#4a7fd4';
  custom.oninput = () => pick(custom.value);
  $('#color-none').hidden = !none;
  $('#color-none').onclick = () => { closePop(); pick(null); };

  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

function outside(ev) {
  if (pop && !pop.contains(ev.target)) closePop();
}
function closePop() {
  if (pop) pop.hidden = true;
  popOwner = null;
  document.removeEventListener('pointerdown', outside, true);
}

const setBar = (btn, color) => {
  const bar = btn.querySelector('.bar');
  bar.style.background = color || 'transparent';
  bar.classList.toggle('bar-none', !color);
};

// ── table size picker ─────────────────────────────────────────────────────

function mountTablePicker() {
  const popT = $('#table-pop'), grid = $('#grid-pick'), label = $('#grid-label');
  const N = 8;
  for (let i = 0; i < N * N; i++) grid.append(el('i'));
  const cells = [...grid.children];
  const lite = (r, c) => {
    cells.forEach((cell, i) => cell.classList.toggle('lit',
      Math.floor(i / N) < r && i % N < c));
    label.textContent = `${r} × ${c}`;
  };
  grid.addEventListener('pointerover', ev => {
    const i = cells.indexOf(ev.target);
    if (i >= 0) lite(Math.floor(i / N) + 1, (i % N) + 1);
  });
  grid.addEventListener('click', ev => {
    const i = cells.indexOf(ev.target);
    if (i < 0) return;
    popT.hidden = true;
    placeTable(Math.floor(i / N) + 1, (i % N) + 1);
  });

  $('#btn-table').onmousedown = ev => ev.preventDefault();
  $('#btn-table').onclick = () => {
    rt.saveRange();
    popT.hidden = !popT.hidden;
    if (popT.hidden) return;
    const r = $('#btn-table').getBoundingClientRect();
    popT.style.left = Math.min(r.left, innerWidth - popT.offsetWidth - 8) + 'px';
    popT.style.top = (r.bottom + 6) + 'px';
    lite(0, 0);
    setTimeout(() => document.addEventListener('pointerdown', function off(e) {
      if (!popT.contains(e.target)) { popT.hidden = true; document.removeEventListener('pointerdown', off, true); }
    }, true), 0);
  };
}

/** Insert at the caret when there is one, otherwise drop a new box holding
 *  the table onto the canvas. */
function placeTable(rows, cols) {
  if (rt.activeEditor() && rt.insertTable(rows, cols)) return;
  const at = cv.viewportAnchor();
  const box = cv.createText(at.x, at.y, Math.min(880, cols * 130 + 24));
  const host = cv.editorFor(box.id);
  if (!host) return;
  host.innerHTML = newTable(rows, cols) + '<p><br></p>';
  host.focus();
  const first = host.querySelector('th, td');
  if (first) {
    const range = document.createRange();
    range.selectNodeContents(first);
    range.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  commit();
}

// ── shape kind ────────────────────────────────────────────────────────────

function shapeMenu(ev) {
  showMenu(ev.clientX, ev.clientY, Object.entries(cv.SHAPES).map(([kind, def]) => ({
    label: def.label + (cv.style.shape === kind ? '  ✓' : ''),
    run: () => { cv.style.shape = kind; cv.setTool('box'); syncState(); },
  })));
}

// ── the shape group folds into a popover when the toolbar runs out of room ─

function reflow() {
  const bar = $('#toolbar'), group = $('#shape-tools');
  const btn = $('#shape-menu'), pop = $('#shape-pop');
  if (!bar || !group) return;
  const wraps = () => bar.offsetHeight > 44;
  if (group.parentElement === pop) {
    btn.before(group);                       // try to put it back inline
    btn.hidden = true;
    if (!wraps()) return;
  }
  if (wraps()) { pop.append(group); btn.hidden = false; }
}

// ── state sync ────────────────────────────────────────────────────────────

export function syncState() {
  const sel = cv.selected();
  const shapes = sel.filter(e => ['box', 'line', 'ink'].includes(e.type));
  const editing = !!rt.activeEditor();

  const cmdState = editing ? rt.queryState() : {};
  $$('.fmt[data-cmd]').forEach(b => {
    b.classList.toggle('on', !!cmdState[b.dataset.cmd]);
    b.disabled = !editing;
  });
  $('#btn-link').disabled = !editing;
  $('#text-color').disabled = !editing;
  $('#hilite-color').disabled = !editing;
  $('#btn-clear-fmt').disabled = !rt.hasSelection();
  $('#box-kind').title = 'Shape: ' + cv.SHAPES[cv.style.shape].label;

  const shapeOn = shapes.length > 0;
  $('#stroke-width').value = String(shapeOn ? (shapes[0].strokeWidth ?? 2) : cv.style.strokeWidth);
  setBar($('#stroke-color'), shapeOn ? shapes[0].stroke : cv.style.stroke);
  const fill = shapeOn ? shapes.find(s => s.type === 'box')?.fill : cv.style.fill;
  setBar($('#fill-color'), fill && fill !== 'none' ? fill : null);
  const lines = shapes.filter(s => s.type === 'line');
  $('#arrow-start').classList.toggle('on', lines.length ? lines[0].arrowStart : cv.style.arrowStart);
  $('#arrow-end').classList.toggle('on', lines.length ? lines[0].arrowEnd : cv.style.arrowEnd);

  const textish = sel.filter(e => e.type === 'text' || e.type === 'box');
  $('#font-select').value = textish[0]?.font || store.doc.meta.font || 'Roboto';
  $('#size-select').value = String(textish[0]?.size || 16);

  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
  $('#zoom-reset').textContent = Math.round(cv.view.scale * 100) + '%';
}

// ── wiring ────────────────────────────────────────────────────────────────

export function mount() {
  $$('.tool').forEach(b => b.onclick = () => cv.setTool(b.dataset.tool));

  $$('.fmt[data-cmd]').forEach(b => {
    b.onmousedown = ev => ev.preventDefault();
    b.onclick = () => { rt.exec(b.dataset.cmd); syncState(); };
  });

  $('#btn-link').onmousedown = ev => ev.preventDefault();
  $('#btn-link').onclick = () => {
    rt.saveRange();
    const url = prompt('Link URL', 'https://');
    if (url) rt.makeLink(url);
  };

  for (const [id, apply, opts] of [
    ['text-color',   c => rt.applyTextColor(c), {}],
    ['hilite-color', c => rt.applyHighlight(c), { none: true }],
  ]) {
    const btn = $('#' + id);
    btn.onmousedown = ev => ev.preventDefault();
    btn.onclick = () => {
      rt.saveRange();
      openColorPop(btn, btn.querySelector('.bar').style.background, c => {
        setBar(btn, c); apply(c); syncState();
      }, opts);
    };
  }

  $('#stroke-color').onclick = () => openColorPop($('#stroke-color'), cv.style.stroke, c => {
    cv.style.stroke = c;
    if (!cv.applyToSelection({ stroke: c })) setBar($('#stroke-color'), c);
    syncState();
  });

  $('#fill-color').onclick = () => openColorPop($('#fill-color'), cv.style.fill, c => {
    cv.style.fill = c || 'none';
    if (!cv.applyToSelection({ fill: c || 'none' })) setBar($('#fill-color'), c);
    syncState();
  }, { none: true });

  $('#stroke-width').onchange = e => {
    const w = +e.target.value;
    cv.style.strokeWidth = w;
    cv.applyToSelection({ strokeWidth: w });
    syncState();
  };

  for (const end of ['start', 'end']) {
    $('#arrow-' + end).onclick = () => {
      const key = end === 'start' ? 'arrowStart' : 'arrowEnd';
      const lines = cv.selected().filter(e => e.type === 'line');
      const next = lines.length ? !lines[0][key] : !cv.style[key];
      cv.style[key] = next;
      for (const l of lines) l[key] = next;
      if (lines.length) { cv.render(); commit(); }
      syncState();
    };
  }

  $('#font-select').onchange = e => {
    const font = e.target.value;
    if (!cv.applyToSelection({ font })) {
      store.doc.meta.font = font;
      cv.render(); commit();
    }
    syncState();
  };

  $('#size-select').onmousedown = () => rt.saveRange();
  $('#size-select').onchange = e => {
    const size = +e.target.value;
    if (rt.hasSelection()) rt.applyFontSize(size);          // just the selected words
    else if (!cv.applyToSelection({ size })) toast('Select some text, a box or a shape first.');
    syncState();
  };

  $('#btn-clear-fmt').onmousedown = ev => ev.preventDefault();
  $('#btn-clear-fmt').onclick = () => { rt.clearFormatting(); syncState(); };

  $('#box-kind').onclick = shapeMenu;
  $('.tool[data-tool="box"]').oncontextmenu = ev => { ev.preventDefault(); shapeMenu(ev); };

  $('#shape-menu').onclick = () => {
    const pop = $('#shape-pop');
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    const r = $('#shape-menu').getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) {
      if (!pop.contains(e.target) && e.target !== $('#shape-menu')) {
        pop.hidden = true;
        document.removeEventListener('pointerdown', off, true);
      }
    }, true), 0);
  };

  $('#btn-export').onclick = ev => showMenu(ev.clientX, ev.clientY, [
    { label: 'Export as PNG',  run: () => exporter.exportPng(2) },
    { label: 'Export as SVG',  run: () => exporter.exportSvg() },
    { label: 'Print / save PDF…', key: '⌘P', run: () => exporter.exportPdf() },
  ]);

  addEventListener('resize', debounce(reflow, 120));
  requestAnimationFrame(reflow);

  $('#btn-undo').onclick = () => { undo(); syncState(); };
  $('#btn-redo').onclick = () => { redo(); syncState(); };
  $('#zoom-in').onclick = () => cv.zoomBy(1.2);
  $('#zoom-out').onclick = () => cv.zoomBy(1 / 1.2);
  $('#zoom-reset').onclick = () => cv.setZoom(1);
  $('#zoom-fit').onclick = () => cv.fitToContent();

  mountTablePicker();
  syncState();
}

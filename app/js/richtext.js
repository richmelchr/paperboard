// Rich-text behaviour inside every `.rt` editor: formatting commands, paste
// rules, list/heading auto-transforms and the editor context menu.

import { commit, store } from './store.js';
import { showMenu } from './menu.js';
import { toast, rgbToHex } from './util.js';
import * as tbl from './table.js';

const URL_RE = /^(https?:\/\/|mailto:|file:\/\/)\S+$/i;

let savedRange = null;
let openNote = () => {};

export const setNoteOpener = fn => { openNote = fn; };

// ── selection bookkeeping ─────────────────────────────────────────────────

export function saveRange() {
  const s = getSelection();
  if (s.rangeCount && s.anchorNode &&
      (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest?.('.rt')) {
    savedRange = s.getRangeAt(0).cloneRange();
  }
  return savedRange;
}

export function restoreRange() {
  if (!savedRange) return false;
  const host = (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer
                : savedRange.startContainer.parentElement)?.closest?.('.rt');
  if (!host || !host.isConnected) return false;
  host.focus();
  const s = getSelection();
  s.removeAllRanges(); s.addRange(savedRange);
  return true;
}

/** True when there is a real, non-empty selection inside an editor. Toolbar
 *  actions that only make sense on a selection are gated on this. */
export function hasSelection() {
  const host = activeEditor();
  if (!host) return false;
  const sel = getSelection();
  if (sel.rangeCount && !sel.isCollapsed &&
      host.contains(sel.anchorNode) && host.contains(sel.focusNode)) return true;
  return !!(savedRange && !savedRange.collapsed && host.contains(savedRange.startContainer));
}

export const activeEditor = () => {
  const a = document.activeElement;
  if (a?.classList?.contains('rt')) return a;
  const c = savedRange?.startContainer;
  const host = (c?.nodeType === 1 ? c : c?.parentElement)?.closest?.('.rt');
  return host?.isConnected ? host : null;
};

/** Forget the parked selection — called when focus leaves the text entirely. */
export function dropRange() { savedRange = null; }

// ── commands ──────────────────────────────────────────────────────────────

export function exec(cmd, value = null) {
  if (!document.activeElement?.classList?.contains('rt')) restoreRange();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, value);
  saveRange();
  commit();
}

/**
 * Apply inline styles to the selection by wrapping each covered text node,
 * rather than the whole range at once — that keeps paragraphs, list items and
 * table cells intact when a selection crosses them.
 */
export function styleRange(props) {
  if (!hasSelection()) return false;
  restoreRange();
  const sel = getSelection();
  const range = sel.getRangeAt(0);
  const host = activeEditor();
  if (!host) return false;

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const targets = [];
  let n;
  while ((n = walker.nextNode())) if (n.data && range.intersectsNode(n)) targets.push(n);

  const { startContainer, startOffset, endContainer, endOffset } = range;
  const wrapped = [];
  for (let node of targets) {
    // Trim the partially covered ends; the end first, so the offsets hold.
    if (node === endContainer && endOffset < node.length) node.splitText(endOffset);
    if (node === startContainer && startOffset > 0) node = node.splitText(startOffset);
    if (!node.data) continue;
    const span = document.createElement('span');
    Object.assign(span.style, props);
    node.replaceWith(span);
    span.appendChild(node);
    wrapped.push(span);
  }
  if (!wrapped.length) return false;

  // Drop the same properties from anything nested inside, so the new value wins.
  for (const span of wrapped) {
    for (const inner of span.querySelectorAll('span')) {
      for (const key of Object.keys(props)) inner.style.removeProperty(key);
      if (!inner.getAttribute('style')) inner.replaceWith(...inner.childNodes);
    }
  }

  const next = document.createRange();
  next.setStartBefore(wrapped[0]);
  next.setEndAfter(wrapped[wrapped.length - 1]);
  sel.removeAllRanges();
  sel.addRange(next);
  tidySpans(host);
  saveRange();
  commit();
  return true;
}

/** Collapse the span soup that repeated styling leaves behind: drop empty
 *  wrappers, drop wrappers whose only child already overrides them, and merge
 *  adjacent siblings that say the same thing. */
export function tidySpans(host) {
  for (const span of [...host.querySelectorAll('span')]) {
    if (!span.isConnected) continue;
    if (!span.getAttribute('style')) { span.replaceWith(...span.childNodes); continue; }
    const kids = [...span.childNodes].filter(n => n.nodeType !== 3 || n.data.trim());
    const only = kids.length === 1 && kids[0].nodeType === 1 && kids[0].tagName === 'SPAN'
      ? kids[0] : null;
    if (only && [...span.style].every(prop => only.style.getPropertyValue(prop))) {
      span.replaceWith(...span.childNodes);
    }
  }
  for (const span of [...host.querySelectorAll('span')]) {
    let sibling = span.nextSibling;
    while (sibling?.nodeType === 1 && sibling.tagName === 'SPAN' &&
           sibling.getAttribute('style') === span.getAttribute('style')) {
      const after = sibling.nextSibling;
      span.append(...sibling.childNodes);
      sibling.remove();
      sibling = after;
    }
  }
  host.normalize();
}

export const applyFontSize = px => styleRange({ fontSize: px + 'px' });

/** Strip character formatting and links, and flatten headings and quotes. */
export function clearFormatting() {
  if (!hasSelection()) return false;
  restoreRange();
  const host = activeEditor();
  const range = getSelection().getRangeAt(0);
  const blocks = [...host.querySelectorAll('h1, h2, h3, h4, h5, h6, blockquote')]
    .filter(b => range.intersectsNode(b));

  document.execCommand('styleWithCSS', false, true);
  document.execCommand('removeFormat');
  document.execCommand('unlink');

  for (const block of blocks) {
    if (!block.isConnected) continue;
    if (block.tagName === 'BLOCKQUOTE') block.replaceWith(...block.childNodes);
    else replaceBlock(block, 'p');
  }
  // removeFormat leaves stripped spans behind
  for (const span of [...host.querySelectorAll('span')]) {
    if (!span.getAttribute('style')) span.replaceWith(...span.childNodes);
  }
  host.normalize();
  saveRange();
  commit();
  return true;
}

export const applyTextColor = c => exec('foreColor', c);
export const applyHighlight = c => exec(c ? 'hiliteColor' : 'removeFormat', c || undefined);

export function insertHTML(html) {
  if (!document.activeElement?.classList?.contains('rt')) if (!restoreRange()) return false;
  document.execCommand('insertHTML', false, html);
  commit();
  return true;
}

export function insertTable(rows, cols) {
  return insertHTML(tbl.newTable(rows, cols) + '<p><br></p>');
}

export function makeLink(url) {
  if (!url) return;
  const s = getSelection();
  if (s && s.isCollapsed) insertHTML(`<a href="${url.replace(/"/g, '%22')}">${url}</a>`);
  else exec('createLink', url);
}

/** What the toolbar should light up for the current caret. */
export function queryState() {
  const out = {};
  for (const c of ['bold', 'italic', 'underline', 'strikeThrough',
                   'insertUnorderedList', 'insertOrderedList']) {
    try { out[c] = document.queryCommandState(c); } catch { out[c] = false; }
  }
  return out;
}

// ── paste ─────────────────────────────────────────────────────────────────

const ALLOWED = new Set(['B','STRONG','I','EM','U','S','STRIKE','DEL','A','CODE','PRE','P',
  'DIV','BR','UL','OL','LI','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TH',
  'TD','SPAN','FONT','BLOCKQUOTE','MARK','SUB','SUP']);

/** Reduce arbitrary pasted HTML to the subset the note format can round-trip. */
export function sanitize(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('script,style,meta,link,head,img,svg,iframe,object').forEach(n => n.remove());
  for (const n of [...box.querySelectorAll('*')]) {
    if (!ALLOWED.has(n.tagName)) { n.replaceWith(...n.childNodes); continue; }
    const href = n.tagName === 'A' ? n.getAttribute('href') : null;
    const color = rgbToHex(n.style.color);
    const bg = rgbToHex(n.style.backgroundColor);
    const bold = /^(700|[89]00|bold)/.test(n.style.fontWeight);
    for (const a of [...n.attributes]) n.removeAttribute(a.name);
    if (href && /^(https?:|mailto:|#|\/)/i.test(href)) n.setAttribute('href', href);
    if (color) n.style.color = color;
    if (bg && bg !== '#ffffff') n.style.backgroundColor = bg;
    if (bold && n.tagName === 'SPAN') n.replaceWith(Object.assign(
      document.createElement('strong'), { innerHTML: n.innerHTML }));
  }
  return box.innerHTML;
}

const escapeText = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function plainToHtml(text) {
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  if (paras.length === 1 && !paras[0].includes('\n')) return null;   // simple inline paste
  return paras.map(p => `<p>${escapeText(p).replace(/\n/g, '<br>') || '<br>'}</p>`).join('');
}

export function pastePlain(text) {
  const html = plainToHtml(text);
  if (html) insertHTML(html);
  else { document.execCommand('insertText', false, text); commit(); }
}

/** ⌘⇧V and the context-menu entry: keep the source formatting. */
export async function pasteFormatted() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const html = await (await item.getType('text/html')).text();
        insertHTML(sanitize(html));
        return;
      }
    }
    const text = await navigator.clipboard.readText();
    pastePlain(text);
  } catch {
    toast('The browser blocked clipboard access — use ⌘⇧V instead.', true);
  }
}

let wantFormatting = false;
window.addEventListener('keydown', ev => {
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'v') wantFormatting = true;
}, true);

function onPaste(ev) {
  const data = ev.clipboardData;
  if (!data) return;
  if ([...data.items].some(i => i.type.startsWith('image/'))) return;   // canvas handles it

  const text = (data.getData('text/plain') || '').trim();
  const sel = getSelection();

  // Slack-style: paste a URL over selected text and the text becomes the link.
  if (URL_RE.test(text) && sel && !sel.isCollapsed) {
    ev.preventDefault();
    exec('createLink', text);
    return;
  }
  ev.preventDefault();
  const html = data.getData('text/html');
  if (wantFormatting && html) insertHTML(sanitize(html));
  else pastePlain(data.getData('text/plain'));
  wantFormatting = false;
}

// ── auto-transforms: "- " -> bullet, "1. " -> number, "# " -> heading ─────

function blockOf(node, root) {
  let n = node.nodeType === 1 ? node : node.parentElement;
  while (n && n !== root && !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE|TD|TH)$/.test(n.tagName)) n = n.parentElement;
  return n && n !== root ? n : root;
}

const TRANSFORMS = [
  [/^[-*+]$/,      { cmd: 'insertUnorderedList' }],
  [/^\d+[.)]$/,    { cmd: 'insertOrderedList' }],
  [/^#$/,          { block: 'h1' }],
  [/^##$/,         { block: 'h2' }],
  [/^###$/,        { block: 'h3' }],
  [/^>$/,          { block: 'blockquote' }],
];

/** Swap a block's tag, carrying its children across. `formatBlock` wraps
 *  rather than replaces inside a contenteditable, which nests <p> in <h1>. */
function replaceBlock(block, tag) {
  const next = document.createElement(tag);
  const host = tag === 'blockquote' ? document.createElement('p') : next;
  while (block.firstChild) host.appendChild(block.firstChild);
  // deleteContents leaves empty text nodes behind; the caret can't sit in one
  [...host.childNodes].forEach(n => { if (n.nodeType === 3 && !n.data) n.remove(); });
  if (!host.firstChild) host.appendChild(document.createElement('br'));
  if (host !== next) next.appendChild(host);
  block.replaceWith(next);
  return host;
}

function caretAtStart(node) {
  let n = node;
  while (n.firstChild && n.firstChild.nodeType === 1 && n.firstChild.tagName !== 'BR') n = n.firstChild;
  const r = document.createRange();
  r.setStart(n, 0); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

/** A range covering the first `n` characters of `block`. */
function rangeOverFirst(block, n) {
  const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  range.setStart(block, 0);
  let left = n, node;
  while ((node = walk.nextNode())) {
    if (left <= node.length) { range.setEnd(node, left); return range; }
    left -= node.length;
  }
  return null;
}

function autoTransform(root, ev) {
  if (ev.inputType !== 'insertText' || ev.data !== ' ') return false;
  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const block = blockOf(r.startContainer, root);
  if (block.tagName === 'LI') return false;

  const probe = document.createRange();
  probe.setStart(block, 0);
  probe.setEnd(r.startContainer, r.startOffset);
  // contenteditable stores the trailing space of "- " as U+00A0.
  const prefix = probe.toString().replace(/\u00a0/g, ' ');
  if (!/^\S{1,3} $/.test(prefix)) return false;

  const hit = TRANSFORMS.find(([re]) => re.test(prefix.trimEnd()));
  if (!hit) return false;

  // Editing commands are ignored while an input event is still dispatching, so
  // drop the marker and apply the block format on the next tick.
  setTimeout(() => {
    const cut = rangeOverFirst(block, prefix.length);
    if (!cut) return;
    cut.deleteContents();
    if (hit[1].block) {
      caretAtStart(replaceBlock(block, hit[1].block));
    } else {
      const caret = document.createRange();
      caret.setStart(block, 0);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(hit[1].cmd);
    }
    commit();
  }, 0);
  return true;
}

// ── per-editor wiring ─────────────────────────────────────────────────────

export function attachEditor(rt, elementId) {
  rt.addEventListener('input', ev => {
    if (autoTransform(rt, ev)) return;      // it commits once it has applied
    commit({ coalesce: true });
  });

  rt.addEventListener('paste', onPaste);
  rt.addEventListener('blur', () => { saveRange(); commit(); });
  rt.addEventListener('keyup', saveRange);
  rt.addEventListener('mouseup', saveRange);

  rt.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); rt.blur(); return; }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const anchor = getSelection().anchorNode;
      const cell = tbl.cellOf(anchor);
      if (cell) {
        // Tab walks the cells; tabbing off the last one adds a row.
        if (!tbl.moveToCell(cell, ev.shiftKey) && !ev.shiftKey) {
          tbl.insertRow(tbl.tableOf(cell), cell, true);
          tbl.moveToCell(cell, false);
          commit();
        }
        return;
      }
      const inList = anchor && blockOf(anchor, rt).tagName === 'LI';
      if (inList) exec(ev.shiftKey ? 'outdent' : 'indent');
      // non-breaking spaces, because a run of plain ones collapses
      else if (!ev.shiftKey) { document.execCommand('insertText', false, '\u00a0\u00a0\u00a0\u00a0'); commit(); }
    }
  });

  rt.addEventListener('click', ev => {
    const a = ev.target.closest('a');
    if (!a) return;
    if (a.dataset.note) { ev.preventDefault(); openNote(a.dataset.note); return; }
    if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  });

  rt.addEventListener('contextmenu', ev => {
    ev.preventDefault(); ev.stopPropagation();
    saveRange();
    const sel = getSelection();
    const hasSel = sel && !sel.isCollapsed;
    const link = (sel?.anchorNode?.nodeType === 1 ? sel.anchorNode
                  : sel?.anchorNode?.parentElement)?.closest?.('a');
    const cell = tbl.cellOf(ev.target);
    const table = cell && tbl.tableOf(cell);
    const op = fn => () => { fn(); commit(); };

    showMenu(ev.clientX, ev.clientY, [
      ...(table ? [
        { label: 'Insert row above',    run: op(() => tbl.insertRow(table, cell, false)) },
        { label: 'Insert row below',    run: op(() => tbl.insertRow(table, cell, true)) },
        { label: 'Insert column left',  run: op(() => tbl.insertColumn(table, cell, false)) },
        { label: 'Insert column right', run: op(() => tbl.insertColumn(table, cell, true)) },
        '-',
        { label: 'Delete row',    run: op(() => tbl.deleteRow(table, cell)) },
        { label: 'Delete column', run: op(() => tbl.deleteColumn(table, cell)) },
        { label: 'Delete table',  run: op(() => table.remove()) },
        '-',
        { label: 'Merge with cell right', run: op(() => {
            if (!tbl.mergeRight(table, cell)) toast('No matching cell to the right.'); }) },
        { label: 'Merge with cell below', run: op(() => {
            if (!tbl.mergeDown(table, cell)) toast('No matching cell below.'); }) },
        tbl.isMerged(cell) && { label: 'Split cell', run: op(() => tbl.splitCell(table, cell)) },
        '-',
        { label: tbl.bordersOn(table) ? 'Hide rules' : 'Show rules',
          run: op(() => tbl.toggleBorders(table)) },
        { label: tbl.hasHeaderRow(table) ? 'Remove header row' : 'Make header row',
          run: op(() => tbl.toggleHeaderRow(table)) },
        '-',
      ] : []),
      { label: 'Paste', key: '⌘V', run: async () => {
          restoreRange();
          try { pastePlain(await navigator.clipboard.readText()); }
          catch { toast('The browser blocked clipboard access — use ⌘V.', true); } } },
      { label: 'Paste with formatting', key: '⌘⇧V', run: () => { restoreRange(); pasteFormatted(); } },
      '-',
      hasSel && { label: 'Cut', key: '⌘X', run: () => document.execCommand('cut') },
      hasSel && { label: 'Copy', key: '⌘C', run: () => document.execCommand('copy') },
      '-',
      { label: link ? 'Edit link…' : 'Add link…', key: '⌘K', run: () => {
          restoreRange();
          const url = prompt('Link URL', link?.getAttribute('href') || 'https://');
          if (url) makeLink(url);
        } },
      link && { label: 'Remove link', run: () => { restoreRange(); exec('unlink'); } },
      '-',
      hasSel && { label: 'Clear formatting', key: '⌘\\', run: clearFormatting },
    ].filter(Boolean));
  });
}

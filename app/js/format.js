// ── The on-disk note format ───────────────────────────────────────────────
//
// A note is one Markdown file. YAML frontmatter carries the metadata and the
// geometry of every canvas element; the body carries the prose, one Markdown
// block per text-bearing element, introduced by an `<!--@id-->` marker.
//
//     ---
//     title: Project Kickoff
//     created: 01JAN2026
//     modified: 03JAN2026
//     font: Roboto
//     elements:
//       - id: t1
//         type: text
//         x: 40
//         y: 40
//         w: 620
//     ---
//
//     <!--@t1-->
//     # Agenda
//
//     - Scope review
//
// The frontmatter uses a deliberately small YAML subset (scalars, and a list
// of flat maps) so that both this file and server.py can read it without a
// YAML library.

import { stamp, uid, rgbToHex } from './util.js';

export const DEFAULT_FONT = 'Roboto';

/** Field order used when writing elements back out, so diffs stay stable. */
const FIELD_ORDER = ['id', 'type', 'shape', 'x', 'y', 'w', 'h', 'bw', 'bh', 'src',
  'from', 'to', 'x1', 'y1', 'x2', 'y2', 'arrowStart', 'arrowEnd', 'd',
  'font', 'size', 'fill', 'stroke', 'strokeWidth', 'radius', 'label'];

const NUMERIC = new Set(['x', 'y', 'w', 'h', 'bw', 'bh', 'x1', 'y1', 'x2', 'y2',
  'strokeWidth', 'radius', 'size']);

// ── frontmatter ───────────────────────────────────────────────────────────

function unquote(s) {
  if (s.length > 1 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    const body = s.slice(1, -1);
    return s[0] === '"' ? body.replace(/\\(["\\nrt])/g, (m, c) =>
      ({ n: '\n', r: '\r', t: '\t' }[c] || c)) : body;
  }
  return s;
}

function coerce(key, raw) {
  const s = unquote(raw);
  if (s === raw) {                       // unquoted -> may be a scalar literal
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    if (s !== '' && !isNaN(Number(s))) return Number(s);
  }
  return NUMERIC.has(key) && s !== '' && !isNaN(Number(s)) ? Number(s) : s;
}

function splitKV(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

export function parseFrontmatter(src) {
  const out = { elements: [] };
  let inList = false, cur = null;
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inList = false; cur = null;
      const kv = splitKV(line);
      if (!kv) continue;
      if (kv[0] === 'elements') { inList = true; continue; }
      out[kv[0]] = coerce(kv[0], kv[1]);
    } else if (inList) {
      const t = line.trimStart();
      if (t.startsWith('-')) {
        cur = {}; out.elements.push(cur);
        const rest = t.replace(/^-\s*/, '');
        if (rest) { const kv = splitKV(rest); if (kv) cur[kv[0]] = coerce(kv[0], kv[1]); }
      } else if (cur) {
        const kv = splitKV(t);
        if (kv) cur[kv[0]] = coerce(kv[0], kv[1]);
      }
    }
  }
  return out;
}

const NEEDS_QUOTES = new RegExp([
  '^$',                                   // empty
  '^[\\s#&*!|>%@`?{}\\[\\],\'"-]',         // leading YAML indicator
  ':\\s', ':$',                            // reads as a nested mapping
  '\\s$',                                  // trailing space would be eaten
  ',',                                    // ambiguous in flow context
  '^(true|false|null|~)$',                // reads as a boolean / null
  '^[-+]?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?$',  // reads as a number
].join('|'));

function emit(v) {
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return String(v);
  const s = String(v ?? '');
  return NEEDS_QUOTES.test(s) ? JSON.stringify(s) : s;
}

// ── body blocks ───────────────────────────────────────────────────────────

const MARKER = /<!--@([A-Za-z0-9_-]+)-->[ \t]*\r?\n?/g;

function splitBlocks(body) {
  const map = {};
  let m, id = null, from = 0;
  MARKER.lastIndex = 0;
  while ((m = MARKER.exec(body))) {
    if (id !== null) map[id] = body.slice(from, m.index);
    id = m[1]; from = MARKER.lastIndex;
  }
  if (id !== null) map[id] = body.slice(from);
  return map;
}

// ── public: note <-> text ─────────────────────────────────────────────────

export function blankDoc(title) {
  return {
    meta: { title, created: stamp(), modified: stamp(), font: DEFAULT_FONT, view: null },
    elements: [{ id: uid('t'), type: 'text', x: 40, y: 40, w: 620, html: '<p><br></p>' }],
  };
}

export function parseNote(text, fallbackTitle = 'Untitled') {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(text || '');
  if (!m) {
    // A plain Markdown file dropped into the folder: adopt it wholesale.
    const doc = blankDoc(fallbackTitle);
    doc.elements[0].html = mdToHtml(text || '');
    return doc;
  }
  const fm = parseFrontmatter(m[1]);
  const blocks = splitBlocks(m[2]);
  const elements = (fm.elements || []).filter(e => e && e.id && e.type).map(e => {
    const node = { ...e };
    if (node.type === 'text' || node.type === 'box') {
      node.html = mdToHtml((blocks[node.id] || '').replace(/\n+$/, ''));
    }
    return node;
  });
  if (!elements.length) elements.push(blankDoc(fallbackTitle).elements[0]);
  const view = typeof fm.view === 'string'
    ? (p => p.length === 3 ? { x: p[0], y: p[1], scale: p[2] } : null)(
        fm.view.split(',').map(Number))
    : null;
  return {
    meta: {
      title: fm.title != null && fm.title !== '' ? String(fm.title) : fallbackTitle,
      created: fm.created || stamp(),
      modified: fm.modified || stamp(),
      font: fm.font || DEFAULT_FONT,
      view,
    },
    elements,
  };
}

export function serializeNote(doc) {
  const lines = ['---'];
  lines.push('title: ' + emit(doc.meta.title));
  lines.push('created: ' + emit(doc.meta.created));
  lines.push('modified: ' + emit(doc.meta.modified));
  lines.push('font: ' + emit(doc.meta.font || DEFAULT_FONT));
  if (doc.meta.view) {
    const v = doc.meta.view;
    lines.push('view: ' + emit([v.x, v.y, v.scale].map(n => Math.round(n * 100) / 100).join(',')));
  }
  lines.push('elements:');
  for (const e of doc.elements) {
    const keys = FIELD_ORDER.filter(k => k in e && e[k] !== undefined &&
                                    e[k] !== null && e[k] !== '');
    const extra = Object.keys(e).filter(k => k !== 'html' && !FIELD_ORDER.includes(k));
    let first = true;
    for (const k of [...keys, ...extra]) {
      lines.push((first ? '  - ' : '    ') + k + ': ' + emit(e[k]));
      first = false;
    }
  }
  lines.push('---', '');

  const body = [];
  for (const e of doc.elements) {
    if (e.html === undefined) continue;
    body.push(`<!--@${e.id}-->`, htmlToMd(e.html), '');
  }
  return lines.join('\n') + '\n' + body.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ── Markdown -> HTML ──────────────────────────────────────────────────────

const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*<table[\s>]/i.test(line)) {
      const buf = [];
      while (i < lines.length) {
        buf.push(lines[i]);
        if (/<\/table>/i.test(lines[i])) { i++; break; }
        i++;
      }
      out.push(buf.join(''));
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|/.test(lines[i + 1] || '')) {
      const r = readTable(lines, i); out.push(r.html); i = r.i; continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length, 3);
      out.push(`<h${lvl}>${inlineToHtml(h[2])}</h${lvl}>`); i++; continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`); continue;
    }
    if (ITEM.test(line)) {
      const r = readList(lines, i, (ITEM.exec(line)[1] || '').length);
      out.push(r.html); i = r.i; continue;
    }
    // Soft-wrapped source lines flow together, as Markdown intends; a hard
    // break is two trailing spaces, which inlineToHtml has turned into <br>.
    let para = '';
    while (i < lines.length && lines[i].trim() && !ITEM.test(lines[i]) &&
           !/^(#{1,6}\s|\s*>|\s*\|)/.test(lines[i])) {
      const piece = inlineToHtml(lines[i]);
      if (para && !/<br>$/.test(para)) para += ' ';
      para += piece;
      i++;
    }
    out.push(`<p>${para}</p>`);
  }
  return out.join('') || '<p><br></p>';
}

function readList(lines, i, indent) {
  const first = ITEM.exec(lines[i]);
  const ordered = !first[2];
  const items = [];
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m) break;
    const ind = (m[1] || '').length;
    if (ind < indent) break;
    if (ind > indent) {
      if (!items.length) break;
      const sub = readList(lines, i, ind);
      items[items.length - 1] += sub.html;
      i = sub.i; continue;
    }
    if (!m[2] !== ordered) break;                 // ul and ol don't merge
    items.push(inlineToHtml(m[4]));
    i++;
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.map(t => `<li>${t}</li>`).join('')}</${tag}>`, i };
}

const splitCells = row => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
  .split(/(?<!\\)\|/).map(c => c.trim());

function readTable(lines, i) {
  const head = splitCells(lines[i]); i += 2;
  const rows = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitCells(lines[i++]));
  // An empty cell needs a <br> placeholder, or the caret can't be put in it.
  const fill = c => inlineToHtml(c) || '<br>';
  const th = head.map(c => `<th>${fill(c)}</th>`).join('');
  const tb = rows.map(r => '<tr>' + head.map((_, c) =>
    `<td>${fill(r[c] || '')}</td>`).join('') + '</tr>').join('');
  return { html: `<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`, i };
}

/** Inline Markdown -> HTML. Escaped chars and code spans are parked first so
 *  they can never be re-interpreted by the emphasis rules. */
export function inlineToHtml(src) {
  const parked = [];
  const park = html => `\u0000${parked.push(html) - 1}\u0000`;
  let s = String(src);

  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~<>])/g, (m, c) => park(escHtml(c)));
  s = s.replace(/`([^`]+)`/g, (m, c) => park(`<code>${c}</code>`));
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (m, name, text) => park(`<a class="wiki" data-note="${escAttr(name.trim())}" href="#">${escHtml(text || name)}</a>`));
  s = s.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, bang, text, url) =>
    park(bang ? `<img src="${escAttr(url)}" alt="${escAttr(text)}">`
              : `<a href="${escAttr(url)}">${text}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/(?:\\|[ \t]{2,})$/, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, n) => parked[+n]);
}

const escHtml = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = t => escHtml(t).replace(/"/g, '&quot;');

// ── HTML -> Markdown ──────────────────────────────────────────────────────

const escText = t => escHtml(t).replace(/([\\`*_\[\]])/g, '\\$1');
const escStart = t => t.replace(/^(\s*)([-*+>#]|\d+[.)])(\s)/, '$1\\$2$3');

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
  'table', 'blockquote', 'pre', 'hr', 'li']);
const hasBlockKids = n => [...n.children].some(c => BLOCK.has(c.tagName.toLowerCase()));

export function htmlToMd(html) {
  const root = document.createElement('div');
  if (html instanceof Node) root.append(...[...html.childNodes].map(n => n.cloneNode(true)));
  else root.innerHTML = String(html ?? '');
  return blocksToMd(root).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function blocksToMd(parent) {
  let out = '';
  for (const n of parent.childNodes) {
    if (n.nodeType === 3) {
      if (n.textContent.trim()) out += escStart(escText(n.textContent.trim())) + '\n\n';
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') { out += listToMd(n, 0) + '\n'; continue; }
    if (tag === 'table') { out += tableToMd(n) + '\n'; continue; }
    if (tag === 'blockquote') {
      out += blocksToMd(n).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      const t = inlineToMd(n).trim();
      if (t) out += '#'.repeat(Math.min(+tag[1], 3)) + ' ' + t + '\n\n';
      continue;
    }
    if (tag === 'pre') { out += '```\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n'; continue; }
    if (tag === 'br') { out += '\n'; continue; }
    if (tag === 'hr') { out += '---\n\n'; continue; }
    if (hasBlockKids(n)) { out += blocksToMd(n); continue; }
    const t = inlineToMd(n).trim();
    out += (t ? escStart(t) : '') + '\n\n';
  }
  return out;
}

function listToMd(list, depth) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const pad = '  '.repeat(depth);
  let out = '', n = 1;
  for (const li of [...list.children].filter(c => c.tagName.toLowerCase() === 'li')) {
    const nested = [...li.children].filter(c => /^(ul|ol)$/i.test(c.tagName));
    const clone = li.cloneNode(true);
    [...clone.children].filter(c => /^(ul|ol)$/i.test(c.tagName)).forEach(c => c.remove());
    const text = inlineToMd(clone).trim().replace(/\\\n/g, '<br>');
    out += pad + (ordered ? `${n++}. ` : '- ') + text + '\n';
    for (const sub of nested) out += listToMd(sub, depth + 1);
  }
  return out;
}

const isComplexTable = table =>
  table.dataset.borders === 'off' ||
  [...table.querySelectorAll('th, td')].some(c => c.colSpan > 1 || c.rowSpan > 1);

/** Merged cells and borderless tables have no pipe-table spelling, so those
 *  are written as a raw HTML block — still a legal Markdown construct. */
function tableToHtml(table) {
  const cell = c => {
    const span = (c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '') +
                 (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '');
    const tag = c.tagName.toLowerCase();
    return `<${tag}${span}>${c.innerHTML.trim() || ''}</${tag}>`;
  };
  const rows = [...table.querySelectorAll('tr')]
    .map(r => '<tr>' + [...r.children].map(cell).join('') + '</tr>');
  const attr = table.dataset.borders === 'off' ? ' data-borders="off"' : '';
  return [`<table${attr}>`, ...rows, '</table>'].join('\n');
}

function tableToMd(table) {
  if (isComplexTable(table)) return tableToHtml(table) + '\n';
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return '';
  // Hard breaks must become <br> before trimming, or a cell holding only a
  // line break trims down to a stray backslash.
  const cellText = c => inlineToMd(c)
    .replace(/\\\n/g, '<br>')
    .replace(/^(?:<br>)+|(?:<br>)+$/g, '')
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ') || ' ';
  const grid = rows.map(r => [...r.children].map(cellText));
  const width = Math.max(...grid.map(r => r.length));
  const pad = r => { while (r.length < width) r.push(' '); return r; };
  const line = r => '| ' + pad(r).join(' | ') + ' |';
  return [line(grid[0]), '|' + ' --- |'.repeat(width),
          ...grid.slice(1).map(line)].join('\n') + '\n';
}

function styleOf(node) {
  const bits = [];
  const color = rgbToHex(node.style.color);
  const bg = rgbToHex(node.style.backgroundColor);
  const size = node.style.fontSize;
  if (color) bits.push('color:' + color);
  if (bg) bits.push('background:' + bg);
  if (size) bits.push('font-size:' + size.trim());
  return bits.join(';');
}

function inlineToMd(node) {
  let s = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { s += escText(n.textContent); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') { s += '\\\n'; continue; }
    if (tag === 'code') { s += '`' + n.textContent.replace(/`/g, '') + '`'; continue; }
    if (tag === 'img') { s += `![${escAttr(n.alt || '')}](${n.getAttribute('src')})`; continue; }
    const inner = inlineToMd(n);
    if (!inner.trim() && tag !== 'a') { s += inner; continue; }
    switch (tag) {
      case 'b': case 'strong': s += wrap(inner, '**'); break;
      case 'i': case 'em':     s += wrap(inner, '*'); break;
      case 's': case 'del': case 'strike': s += wrap(inner, '~~'); break;
      case 'u':   s += `<u>${inner}</u>`; break;
      case 'sub': s += `<sub>${inner}</sub>`; break;
      case 'sup': s += `<sup>${inner}</sup>`; break;
      case 'mark': s += `<span style="background:${rgbToHex(n.style.backgroundColor) || '#ffe479'}">${inner}</span>`; break;
      case 'a':
        if (n.dataset.note) s += `[[${n.dataset.note}${inner && inner !== n.dataset.note ? '|' + inner : ''}]]`;
        else s += `[${inner}](${n.getAttribute('href') || ''})`;
        break;
      case 'span': case 'font': {
        const st = styleOf(n);
        s += st ? `<span style="${st}">${inner}</span>` : inner;
        break;
      }
      default: s += inner;
    }
  }
  return s;
}

/** Emphasis markers must hug the text, so push spaces outside them. */
function wrap(inner, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
}

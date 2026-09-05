// Paper — the whole front end, in one module.
//
// Each former file keeps its own scope inside an IIFE and hands back only what
// it used to export, so private helpers stay private and no two sections can
// tread on each other's names. The sections are ordered so that every one of
// them runs after whatever it depends on.

// ══ util ════════════════════════════════════════════════════════════════════
// Small shared helpers.

const M_util = (() => {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function el(tag, attrs = {}, ...kids) {
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

  const uid = (p = 'e') => p + Math.random().toString(36).slice(2, 8);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function debounce(fn, ms) {
    let t;
    const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    wrapped.cancel = () => clearTimeout(t);
    wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
    return wrapped;
  }

  /** `01JAN2026` — the date format used throughout, per the spec. */
  function stamp(d = new Date()) {
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return String(d.getDate()).padStart(2, '0') + M[d.getMonth()] + d.getFullYear();
  }

  function rgbToHex(value) {
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
  function contrastOn(bg) {
    const hex = rgbToHex(bg);
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.36 ? '#1c1b19' : '#f2f0ec';
  }

  let toastTimer;
  function toast(msg, bad = false) {
    const box = $('#toast');
    box.textContent = msg;
    box.classList.toggle('bad', bad);
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, bad ? 5000 : 2200);
  }

  const dirOf  = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
  const stemOf = p => baseOf(p).replace(/\.md$/i, '');
  const join   = (a, b) => (a ? a + '/' : '') + b;

  return { $, $$, el, uid, clamp, debounce, stamp, rgbToHex, contrastOn, toast, dirOf, baseOf,
    stemOf, join };
})();

// ══ api ═════════════════════════════════════════════════════════════════════
// Thin wrapper over the server's JSON API.

const M_api = (() => {
  async function req(url, opts = {}) {
    const res = await fetch(url, opts);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    if (!res.ok || (data && data.error)) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  const q = obj => new URLSearchParams(obj).toString();
  const post = (url, body) => req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const api = {
    tree:      ()               => req('/api/tree'),
    read:      path             => req('/api/note?' + q({ path })),
    write:     (path, text)     => req('/api/note?' + q({ path }), { method: 'PUT', body: text }),
    create:    (path, kind)     => post('/api/create', { path, kind }),
    rename:    (from, to)       => post('/api/rename', { from, to }),
    remove:    path             => post('/api/delete', { path }),
    setColor:  (path, color)    => post('/api/color', { path, color }),
    setEmoji:  (path, emoji)    => post('/api/emoji', { path, emoji }),
    setOrder:  (parent, paths)  => post('/api/order', { parent, paths }),
    setArchived: (path, archived) => post('/api/archive', { path, archived }),
    search:    (text, archived) => req('/api/search?' + q(archived ? { q: text, archived: 1 }
                                                                  : { q: text })),
    links:     ()               => req('/api/links'),
    history:   path             => req('/api/history?' + q({ path })),
    actions:   path             => req('/api/actions?' + q({ path })),
    setActions: (path, actions)  => post('/api/actions', { path, actions }),
    version:   (path, at)       => req('/api/history?' + q({ path, at })),
    restore:   (path, at)       => post('/api/restore', { path, at }),
    changes:   since            => req('/api/changes?' + q({ since })),
    upload:    (path, ext, blob) =>
      req('/api/image?' + q({ path, ext }), { method: 'POST', body: blob }),
    imagePath: (path, src)      => post('/api/image-path', { path, src }),
  };

  /** URL at which the browser can load an image referenced from a note. */
  const imageUrl = (notePath, src) => {
    if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
    const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '';
    return '/notes/' + (dir + src).split('/').map(encodeURIComponent).join('/');
  };

  return { api, imageUrl };
})();

// ══ format ══════════════════════════════════════════════════════════════════
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

const M_format = (() => {
  const { stamp, uid, rgbToHex } = M_util;

  const DEFAULT_FONT = 'Roboto';

  /** Field order used when writing elements back out, so diffs stay stable. */
  const FIELD_ORDER = ['id', 'type', 'shape', 'x', 'y', 'w', 'h', 'bw', 'bh', 'src', 'showPath',
    'from', 'fromPort', 'to', 'toPort', 'x1', 'y1', 'x2', 'y2', 'arrowStart', 'arrowEnd', 'd',
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

  function parseFrontmatter(src) {
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

  // Frontmatter keys Paper owns. Everything else — a `tags:` list, an `aliases:`
  // block, whatever another tool wrote — is not understood, and is therefore
  // kept verbatim rather than interpreted: opening a note in Paper and saving it
  // must never be the reason a field disappeared. Foreign keys are carried on
  // meta.extra as raw source lines and written back in their original order.
  const OWN_KEYS = new Set(['title', 'created', 'modified', 'font', 'view', 'elements']);

  const TOP_KEY = /^[^\s#][^:]*:/;

  /** Raw frontmatter lines belonging to top-level keys Paper does not own. */
  function foreignLines(src) {
    const keep = [];
    let keeping = false;
    for (const line of src.split(/\r?\n/)) {
      if (line === line.trimStart() && TOP_KEY.test(line)) {
        keeping = !OWN_KEYS.has(splitKV(line)[0]);
      }
      if (keeping) keep.push(line);
    }
    while (keep.length && !keep[keep.length - 1].trim()) keep.pop();
    return keep;
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

  /**
   * Split a body on its markers, in file order. A chunk with a null id is text
   * that arrived before any marker — orphaned prose the caller has to place.
   */
  function splitBlocks(body) {
    const chunks = [];
    let m, id = null, from = 0;
    MARKER.lastIndex = 0;
    while ((m = MARKER.exec(body))) {
      const text = body.slice(from, m.index);
      if (id !== null || text.trim()) chunks.push({ id, text });
      id = m[1]; from = MARKER.lastIndex;
    }
    const tail = body.slice(from);
    if (id !== null || tail.trim()) chunks.push({ id, text: tail });
    return chunks;
  }

  /** A text element parked below the others, to hold body text with no home. */
  function adopted(elements, html) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const bottom = elements.reduce((y, e) => Math.max(y, num(e.y, 0) + num(e.h, 0)), 0);
    const left = elements.reduce((x, e) => Math.min(x, num(e.x, Infinity)), Infinity);
    return { id: uid('t'), type: 'text', x: Number.isFinite(left) ? left : 40,
             y: bottom + 40, w: 620, html };
  }

  // ── public: note <-> text ─────────────────────────────────────────────────

  function blankDoc(title) {
    return {
      meta: { title, created: stamp(), modified: stamp(), font: DEFAULT_FONT, view: null },
      elements: [{ id: uid('t'), type: 'text', x: 40, y: 40, w: 620, html: '<p><br></p>' }],
    };
  }

  function parseNote(text, fallbackTitle = 'Untitled') {
    const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(text || '');
    if (!m) {
      // A plain Markdown file dropped into the folder: adopt it wholesale.
      const doc = blankDoc(fallbackTitle);
      doc.elements[0].html = mdToHtml(text || '');
      return doc;
    }
    const fm = parseFrontmatter(m[1]);
    const chunks = splitBlocks(m[2]);
    const blocks = {};
    for (const c of chunks) if (c.id !== null) blocks[c.id] = c.text;
    const claimed = new Set();
    const elements = (fm.elements || []).filter(e => e && e.id && e.type).map(e => {
      const node = { ...e };
      if (node.type === 'text' || node.type === 'box') {
        claimed.add(node.id);
        node.html = mdToHtml((blocks[node.id] || '').replace(/\n+$/, ''));
      }
      return node;
    });
    // Body text no element claims: a Markdown file carrying ordinary
    // frontmatter, prose above the first marker, or a block whose element
    // definition was missing or malformed. It is adopted rather than dropped,
    // because the next save writes this document back over the file.
    const orphan = chunks.filter(c => c.id === null || !claimed.has(c.id))
      .map(c => c.text.replace(/^\n+|\n+$/g, '')).filter(Boolean).join('\n\n');
    if (!elements.length) {
      const solo = blankDoc(fallbackTitle).elements[0];
      if (orphan) solo.html = mdToHtml(orphan);
      elements.push(solo);
    } else if (orphan) {
      elements.push(adopted(elements, mdToHtml(orphan)));
    }
    const view = typeof fm.view === 'string'
      ? (p => p.length === 3 ? { x: p[0], y: p[1], scale: p[2] } : null)(
          fm.view.split(',').map(Number))
      : null;
    const extra = foreignLines(m[1]);
    return {
      meta: {
        title: fm.title != null && fm.title !== '' ? String(fm.title) : fallbackTitle,
        created: fm.created || stamp(),
        modified: fm.modified || stamp(),
        font: fm.font || DEFAULT_FONT,
        view,
        ...(extra.length ? { extra } : {}),
      },
      elements,
    };
  }

  function serializeNote(doc) {
    const lines = ['---'];
    lines.push('title: ' + emit(doc.meta.title));
    lines.push('created: ' + emit(doc.meta.created));
    lines.push('modified: ' + emit(doc.meta.modified));
    lines.push('font: ' + emit(doc.meta.font || DEFAULT_FONT));
    if (doc.meta.view) {
      const v = doc.meta.view;
      lines.push('view: ' + emit([v.x, v.y, v.scale].map(n => Math.round(n * 100) / 100).join(',')));
    }
    if (doc.meta.extra && doc.meta.extra.length) lines.push(...doc.meta.extra);
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

  // A table needs a header row *and* the dashed divider under it. A lone
  // pipe-prefixed line is ordinary prose, so it must fall through to the
  // paragraph reader rather than being held back for a table that isn't there.
  const isTableStart = (lines, i) => /^\s*\|/.test(lines[i] || '') &&
    /^\s*\|?[\s:|-]*-[\s:|-]*\|/.test(lines[i + 1] || '');

  /** A CommonMark-style opening fence. Paper keeps one optional, simple
   *  language name; other info-string syntax remains code, but is not attached
   *  to the editable HTML because there is nowhere lossless to store it. */
  function fenceStart(line) {
    const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line || '');
    if (!m) return null;
    const info = m[3].trim();
    if (m[2][0] === '`' && info.includes('`')) return null;
    return {
      mark: m[2][0], length: m[2].length,
      language: /^[A-Za-z0-9_+.-]+$/.test(info) ? info : '',
    };
  }

  const fenceClose = (line, fence) => {
    const m = /^ {0,3}(`+|~+)[ \t]*$/.exec(line || '');
    return !!m && m[1][0] === fence.mark && m[1].length >= fence.length;
  };

  function mdToHtml(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      const fence = fenceStart(line);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !fenceClose(lines[i], fence)) body.push(lines[i++]);
        if (i < lines.length) i++;                  // consume the closing fence
        const code = escHtml(body.join('\n'));
        out.push(fence.language
          ? `<pre><code class="language-${escAttr(fence.language)}">${code}</code></pre>`
          : `<pre>${code}</pre>`);
        continue;
      }
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
      if (isTableStart(lines, i)) {
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
      const from = i;
      while (i < lines.length && lines[i].trim() && !ITEM.test(lines[i]) &&
             !/^(#{1,6}\s|\s*>)/.test(lines[i]) && !fenceStart(lines[i]) &&
             !isTableStart(lines, i)) {
        const piece = inlineToHtml(lines[i]);
        if (para && !/<br>$/.test(para)) para += ' ';
        para += piece;
        i++;
      }
      // Nothing else claimed this line, so prose must: every iteration has to
      // consume a line, or the outer loop would spin on it forever.
      if (i === from) { para = inlineToHtml(lines[i]); i++; }
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
  function inlineToHtml(src) {
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

  const WRAP = 80;

  /**
   * Soft-wrap a paragraph so the files stay diff-friendly. Reading joins these
   * lines back with a space, so wrapping is invisible in the app — but it keeps
   * a one-word edit from rewriting a whole paragraph in `git diff`.
   *
   * Splits only at spaces that sit outside tags, code spans and link targets, so
   * `<span style="...">` and `[text](url with space)` are never broken up.
   */
  function wrapParagraph(text) {
    if (text.length <= WRAP) return escStart(text);
    const atoms = [];
    let buf = '', tag = false, code = false, link = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '`' && !tag) code = !code;
      else if (ch === '<' && !code) tag = true;
      else if (ch === '>' && !code) tag = false;
      else if (ch === '(' && text[i - 1] === ']' && !code) link++;
      else if (ch === ')' && link && !code) link--;
      if (ch === ' ' && !tag && !code && !link) {
        if (buf) atoms.push(buf);
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf) atoms.push(buf);

    const lines = [];
    let line = '';
    for (const atom of atoms) {
      if (line && line.length + 1 + atom.length > WRAP) { lines.push(line); line = atom; }
      else line = line ? line + ' ' + atom : atom;
    }
    if (line) lines.push(line);
    return lines.map(escStart).join('\n');
  }

  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
    'table', 'blockquote', 'pre', 'hr', 'li']);
  const hasBlockKids = n => [...n.children].some(c => BLOCK.has(c.tagName.toLowerCase()));

  function htmlToMd(html) {
    const root = document.createElement('div');
    if (html instanceof Node) root.append(...[...html.childNodes].map(n => n.cloneNode(true)));
    else root.innerHTML = String(html ?? '');
    return cleanMarkdown(blocksToMd(root));
  }

  /** Apply the usual source cleanup only outside fenced code. Global regexes
   *  would otherwise erase trailing spaces and collapse blank lines in code. */
  function cleanMarkdown(source) {
    const out = [];
    let fence = null, blanks = 0;
    for (const raw of String(source).replace(/\r\n?/g, '\n').split('\n')) {
      if (fence) {
        out.push(raw);
        if (fenceClose(raw, fence)) fence = null;
        continue;
      }
      const line = raw.replace(/[ \t]+$/, '');
      const opening = fenceStart(line);
      if (!line) { blanks++; continue; }
      if (out.length && blanks) out.push('');
      blanks = 0;
      out.push(line);
      if (opening) fence = opening;
    }
    return out.join('\n');
  }

  /** Fence longer than every backtick run in the code, so even a literal
   *  triple-backtick line cannot close the block early. A trailing newline in
   *  the DOM becomes a deliberate blank line before the closing fence. */
  function preToMd(pre) {
    const code = pre.textContent.replace(/\r\n?/g, '\n');
    const runs = code.match(/`+/g) || [];
    const width = Math.max(3, ...runs.map(run => run.length + 1));
    const fence = '`'.repeat(width);
    const child = pre.children.length === 1 && pre.firstElementChild?.tagName === 'CODE'
      ? pre.firstElementChild : null;
    const language = child && [...child.classList]
      .map(name => /^language-([A-Za-z0-9_+.-]+)$/.exec(name)?.[1])
      .find(Boolean) || '';
    return fence + language + '\n' + code + '\n' + fence;
  }

  function blocksToMd(parent) {
    let out = '';
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) {
        if (n.textContent.trim()) out += wrapParagraph(escText(n.textContent.trim())) + '\n\n';
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
      if (tag === 'pre') { out += preToMd(n) + '\n\n'; continue; }
      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'hr') { out += '---\n\n'; continue; }
      if (hasBlockKids(n)) { out += blocksToMd(n); continue; }
      const t = inlineToMd(n).trim();
      out += (t ? wrapParagraph(t) : '') + '\n\n';
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

  /** A pipe table can spell out a plain grid with a header and nothing else,
   *  so any table carrying different structure or styling — no header, merged
   *  cells, hidden rules, row numbers, a line colour, dragged column widths —
   *  goes out as raw HTML. Pipe Markdown always promotes row one to a header,
   *  so it cannot represent the Header-off state without changing the table. */
  const isComplexTable = table =>
    table.querySelector('tr')?.children[0]?.tagName !== 'TH' ||
    table.dataset.borders === 'off' ||
    table.dataset.numbers === 'on' ||
    !!table.getAttribute('style') ||
    !!table.querySelector('colgroup') ||
    [...table.querySelectorAll('tr')].some(r => r.getAttribute('style')) ||
    [...table.querySelectorAll('th, td')].some(c => c.colSpan > 1 || c.rowSpan > 1);

  const escAttrValue = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  /** `style="…"` when the node carries one, otherwise nothing. */
  const styleAttr = node => {
    const v = node.getAttribute && node.getAttribute('style');
    return v ? ` style="${escAttrValue(v)}"` : '';
  };

  /**
   * Headerless, merged and borderless tables have no lossless pipe-table
   * spelling, so those are written as a raw HTML block — still a legal Markdown
   * construct. The section split is written out too: drop the `<thead>` and the
   * browser re-reads every row into one `<tbody>`, so the table that comes back
   * is not the table that went out, and nothing downstream can tell the two
   * states apart.
   */
  function tableToHtml(table) {
    const cell = c => {
      const span = (c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '') +
                   (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '');
      const tag = c.tagName.toLowerCase();
      return `<${tag}${span}${styleAttr(c)}>${c.innerHTML.trim() || ''}</${tag}>`;
    };
    const row = r => `<tr${styleAttr(r)}>` + [...r.children].map(cell).join('') + '</tr>';
    const part = node => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'colgroup')
        return '<colgroup>' + [...node.children].map(c => `<col${styleAttr(c)}>`).join('') + '</colgroup>';
      if (tag === 'tr') return row(node);
      return `<${tag}>` + [...node.children].map(row).join('') + `</${tag}>`;
    };
    const attr = (table.dataset.borders === 'off' ? ' data-borders="off"' : '') +
                 (table.dataset.numbers === 'on' ? ' data-numbers="on"' : '') +
                 styleAttr(table);
    return [`<table${attr}>`, ...[...table.children].map(part), '</table>'].join('\n');
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
    const family = node.style.fontFamily;
    if (color) bits.push('color:' + color);
    if (bg) bits.push('background:' + bg);
    if (size) bits.push('font-size:' + size.trim());
    if (family) bits.push('font-family:' + family.replaceAll('"', "'"));
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

  return { DEFAULT_FONT, parseFrontmatter, blankDoc, parseNote, serializeNote, mdToHtml,
    inlineToHtml, htmlToMd };
})();

// ══ table ═══════════════════════════════════════════════════════════════════
// Editing an existing table: rows, columns, merging, splitting and rules.
//
// Everything here works off a grid map — a row-major array where a cell that
// spans several rows or columns appears once per position it occupies. That is
// what makes "the cell below this one" and "column index 3" well defined once
// merges are in play.

const M_table = (() => {
  /** Row-major map of the table; `grid[r][c]` is the cell occupying that slot. */
  function gridOf(table) {
    const rows = [...table.querySelectorAll('tr')];
    const grid = rows.map(() => []);
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of row.children) {
        while (grid[r][c]) c++;                       // slot taken by a rowspan
        for (let dr = 0; dr < cell.rowSpan; dr++) {
          for (let dc = 0; dc < cell.colSpan; dc++) {
            (grid[r + dr] ||= [])[c + dc] = cell;
          }
        }
        c += cell.colSpan;
      }
    });
    const width = Math.max(0, ...grid.map(g => g.length));
    return { table, rows, grid, width };
  }

  /** Where `cell` starts in the grid. */
  function locate(g, cell) {
    for (let r = 0; r < g.grid.length; r++) {
      const c = g.grid[r].indexOf(cell);
      if (c !== -1) return { r, c };
    }
    return null;
  }

  const like = (model, tag) => {
    const cell = document.createElement(tag || model.tagName.toLowerCase());
    cell.appendChild(document.createElement('br'));
    return cell;
  };

  const cellOf = node =>
    (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('th, td') || null;
  const tableOf = node =>
    (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('table') || null;

  // ── rows ──────────────────────────────────────────────────────────────────

  function insertRow(table, cell, below) {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at) return;
    const index = below ? at.r + (cell.rowSpan || 1) : at.r;
    const row = document.createElement('tr');
    const grown = new Set();      // a wide cell holds the seam in several slots
    for (let c = 0; c < g.width; c++) {
      // A cell spanning across the seam grows instead of being duplicated —
      // once, however many columns of the seam it happens to cover.
      const above = index > 0 ? g.grid[index - 1]?.[c] : null;
      const here = g.grid[index]?.[c];
      if (above && here && above === here) {
        if (!grown.has(above)) { above.rowSpan += 1; grown.add(above); }
        continue;
      }
      row.appendChild(like(g.grid[at.r][c] || cell, 'td'));
    }
    const anchor = g.rows[index];
    if (anchor) anchor.parentNode.insertBefore(row, anchor);
    else (table.tBodies[0] || table).appendChild(row);
  }

  function deleteRow(table, cell) {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at || g.rows.length < 2) return;
    const row = g.rows[at.r];
    const next = g.rows[at.r + 1];
    for (let c = 0; c < g.width;) {
      const occupant = g.grid[at.r][c];
      if (!occupant) { c++; continue; }
      const start = locate(g, occupant);
      if (start.r === at.r && occupant.rowSpan > 1 && next) {
        // Starts here and continues below: move it down a row, one span shorter.
        occupant.rowSpan -= 1;
        const before = nextSiblingAt(g, at.r + 1, c);
        next.insertBefore(occupant, before);
      } else if (start.r < at.r) {
        occupant.rowSpan -= 1;                       // just passing through
      }
      c += occupant.colSpan;
    }
    row.remove();
  }

  /** The cell in row `r` that should follow column `c`, for insertBefore. */
  function nextSiblingAt(g, r, c) {
    for (let x = c; x < g.width; x++) {
      const cell = g.grid[r]?.[x];
      if (cell && locate(g, cell).r === r) return cell;
    }
    return null;
  }

  // ── columns ───────────────────────────────────────────────────────────────

  function insertColumn(table, cell, after) {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at) return;
    const index = after ? at.c + (cell.colSpan || 1) : at.c;
    spliceCol(table, index, null);                  // pinned widths shift with it
    const grown = new Set();      // a tall cell holds the seam in several rows
    for (let r = 0; r < g.rows.length; r++) {
      const left = index > 0 ? g.grid[r][index - 1] : null;
      const here = g.grid[r][index];
      // Straddling the seam: it grows once, and that growth already covers the
      // new column in every row the cell reaches.
      if (left && here && left === here) {
        if (!grown.has(left)) { left.colSpan += 1; grown.add(left); }
        continue;
      }
      // Every other row needs a cell of its own — including a row merely passed
      // through by a rowspan, which still has an empty slot in the new column.
      // It goes before the first cell this row starts itself at or after the
      // seam, since a row only holds the cells that begin in it.
      const model = g.grid[r][at.c] || here || left || cell;
      g.rows[r].insertBefore(like(model, model.tagName.toLowerCase()),
                             nextSiblingAt(g, r, index));
    }
  }

  function deleteColumn(table, cell) {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at || g.width < 2) return;
    spliceCol(table, at.c);
    const dead = new Set(), seen = new Set();
    for (let r = 0; r < g.rows.length; r++) {
      const occupant = g.grid[r][at.c];
      // A tall cell stands in this column once per row it covers, but it is
      // still one cell losing one column: decide from the span it arrived with,
      // never from a span this same loop has already shortened.
      if (!occupant || seen.has(occupant)) continue;
      seen.add(occupant);
      if (occupant.colSpan > 1) occupant.colSpan -= 1;
      else dead.add(occupant);
    }
    dead.forEach(c => c.remove());
    const after = gridOf(table);
    for (let r = after.rows.length - 1; r >= 0; r--) {
      if (after.rows[r].children.length) continue;
      // Nothing begins in this row any more, so it goes — and the cells that
      // were reaching down into it give up the row they can no longer cover.
      new Set(after.grid[r] || []).forEach(c => { if (c?.rowSpan > 1) c.rowSpan -= 1; });
      after.rows[r].remove();
    }
  }

  // ── merge and split ───────────────────────────────────────────────────────

  const absorb = (into, from) => {
    const text = from.textContent.trim();
    if (!text) return;
    if (!into.textContent.trim()) into.innerHTML = from.innerHTML;
    else into.innerHTML += '<br>' + from.innerHTML;
  };

  function mergeRight(table, cell) {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at) return false;
    const neighbour = g.grid[at.r][at.c + cell.colSpan];
    if (!neighbour || neighbour === cell || neighbour.rowSpan !== cell.rowSpan) return false;
    cell.colSpan += neighbour.colSpan;
    absorb(cell, neighbour);
    neighbour.remove();
    return true;
  }

  function mergeDown(table, cell) {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at) return false;
    const neighbour = g.grid[at.r + cell.rowSpan]?.[at.c];
    if (!neighbour || neighbour === cell || neighbour.colSpan !== cell.colSpan) return false;
    cell.rowSpan += neighbour.rowSpan;
    absorb(cell, neighbour);
    neighbour.remove();
    return true;
  }

  const isMerged = cell => cell.colSpan > 1 || cell.rowSpan > 1;

  function splitCell(table, cell) {
    if (!isMerged(cell)) return false;
    const g = gridOf(table);
    const at = locate(g, cell);
    const cols = cell.colSpan, rows = cell.rowSpan;
    cell.colSpan = 1;
    cell.rowSpan = 1;

    for (let dc = 1; dc < cols; dc++) {
      cell.parentNode.insertBefore(like(cell), cell.nextSibling);
    }
    for (let dr = 1; dr < rows; dr++) {
      const row = g.rows[at.r + dr];
      if (!row) break;
      const before = nextSiblingAt(gridOf(table), at.r + dr, at.c);
      for (let dc = 0; dc < cols; dc++) row.insertBefore(like(cell), before);
    }
    return true;
  }

  // ── rules ─────────────────────────────────────────────────────────────────

  function toggleBorders(table) {
    if (table.dataset.borders === 'off') delete table.dataset.borders;
    else table.dataset.borders = 'off';
  }

  const bordersOn = table => table.dataset.borders !== 'off';

  function toggleHeaderRow(table) {
    const first = table.querySelector('tr');
    if (!first) return;
    const toHeader = first.children[0]?.tagName === 'TD';
    for (const cell of [...first.children]) {
      const swap = document.createElement(toHeader ? 'th' : 'td');
      swap.innerHTML = cell.innerHTML;
      if (cell.colSpan > 1) swap.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) swap.rowSpan = cell.rowSpan;
      cell.replaceWith(swap);
    }
  }

  const hasHeaderRow = table => table.querySelector('tr')?.children[0]?.tagName === 'TH';

  // ── caret movement ────────────────────────────────────────────────────────

  /** Tab / ⇧Tab hop between cells. Returns false at the ends of the table. */
  function moveToCell(cell, back) {
    const all = [...tableOf(cell).querySelectorAll('th, td')];
    const next = all[all.indexOf(cell) + (back ? -1 : 1)];
    if (!next) return false;
    const range = document.createRange();
    range.selectNodeContents(next);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  // ── size: dragged column widths and row heights ───────────────────────────
  //
  // A table sizes itself to its content until the moment someone pins a width,
  // at which point every column is frozen at whatever it measures right then
  // and the table switches to a fixed layout. Without that first freeze,
  // widening one column would silently steal room from its neighbours.

  const MIN_COL = 28;
  const MIN_ROW = 18;

  /**
   * Keep the <colgroup> lined up with the columns as they come and go: adding a
   * column at index 3 must widen slot 3, not silently shunt every width along.
   * `width` null inserts (borrowing the neighbour's width); omitted deletes.
   */
  function spliceCol(table, index, width = undefined) {
    const group = table.querySelector('colgroup');
    if (!group) return;                             // nothing pinned yet
    if (width === undefined) { group.children[index]?.remove(); return; }
    const col = document.createElement('col');
    col.style.width = width ||
      group.children[index]?.style.width || group.lastElementChild?.style.width || MIN_COL * 4 + 'px';
    group.insertBefore(col, group.children[index] || null);
  }

  /** Current on-screen width of each column, in unzoomed CSS pixels. Only
   *  single-column cells can speak for a column; spanning ones cannot. */
  function measureColumns(table) {
    const g = gridOf(table);
    const out = new Array(g.width).fill(0);
    for (let r = 0; r < g.rows.length; r++) {
      for (let c = 0; c < g.width; c++) {
        const cell = g.grid[r]?.[c];
        if (!cell || cell.colSpan > 1) continue;
        out[c] = Math.max(out[c], cell.offsetWidth);
      }
    }
    // Columns only ever covered by a spanning cell still need some width.
    const fallback = Math.max(MIN_COL, Math.round(table.offsetWidth / (g.width || 1)));
    return out.map(w => Math.max(MIN_COL, Math.round(w || fallback)));
  }

  /** The <colgroup> driving the widths, created from the current layout the
   *  first time it is needed. */
  function ensureColgroup(table) {
    const width = gridOf(table).width;
    let group = table.querySelector('colgroup');
    if (!group) {
      const measured = measureColumns(table);
      group = document.createElement('colgroup');
      for (let c = 0; c < width; c++) {
        const col = document.createElement('col');
        col.style.width = measured[c] + 'px';
        group.appendChild(col);
      }
      table.insertBefore(group, table.firstChild);
    }
    // Rows added or removed since: keep one <col> per column.
    while (group.children.length > width) group.lastElementChild.remove();
    while (group.children.length < width) {
      const col = document.createElement('col');
      col.style.width = (group.lastElementChild?.style.width || MIN_COL * 4 + 'px');
      group.appendChild(col);
    }
    return group;
  }

  /** Keep the table's own width in step with the columns it now holds. */
  function retotal(table) {
    const group = table.querySelector('colgroup');
    if (!group) return;
    const total = [...group.children].reduce((n, col) => n + (parseInt(col.style.width, 10) || 0), 0);
    table.style.tableLayout = 'fixed';
    table.style.width = total + 'px';
    table.style.minWidth = total + 'px';        // beats the stylesheet's floor
  }

  const columnIndex = (table, cell) => locate(gridOf(table), cell)?.c ?? null;
  /** Where `cell` sits in `table`, as `{ r, c }` — null if it is not in it. */
  const positionOf = (table, cell) => locate(gridOf(table), cell);
  /** The cell nearest to grid position `r,c`, for putting a caret back. */
  function cellNear(table, r, c) {
    const g = gridOf(table);
    if (!g.grid.length || !g.width) return null;
    return g.grid[Math.min(r, g.grid.length - 1)]?.[Math.min(c, g.width - 1)]
        || table.querySelector('td, th');
  }

  function columnWidth(table, cell) {
    const c = columnIndex(table, cell);
    if (c == null) return null;
    const col = table.querySelector('colgroup')?.children[c];
    const pinned = col && parseInt(col.style.width, 10);
    return pinned || measureColumns(table)[c] || null;
  }

  function setColumnWidth(table, cell, px) {
    const c = columnIndex(table, cell);
    if (c == null) return false;
    const col = ensureColgroup(table).children[c];
    if (!col) return false;
    col.style.width = Math.max(MIN_COL, Math.round(px)) + 'px';
    retotal(table);
    return true;
  }

  const rowOf = cell => cell?.closest?.('tr') || null;

  function rowHeight(cell) {
    const row = rowOf(cell);
    if (!row) return null;
    return parseInt(row.style.height, 10) || Math.round(row.offsetHeight) || null;
  }

  function setRowHeight(cell, px) {
    const row = rowOf(cell);
    if (!row) return false;
    row.style.height = Math.max(MIN_ROW, Math.round(px)) + 'px';
    return true;
  }

  /** Widths are per column and heights per row, so both need re-fitting after
   *  a structural change. Called once after every row/column edit. */
  function refit(table) {
    if (table.querySelector('colgroup')) { ensureColgroup(table); retotal(table); }
  }

  // ── row numbers, line colour, sorting ─────────────────────────────────────

  const hasRowNumbers = table => table.dataset.numbers === 'on';

  function toggleRowNumbers(table) {
    if (hasRowNumbers(table)) delete table.dataset.numbers;
    else table.dataset.numbers = 'on';
  }

  const lineColor = table => table.style.getPropertyValue('--tbl-line').trim() || null;

  function setLineColor(table, color) {
    if (color) table.style.setProperty('--tbl-line', color);
    else table.style.removeProperty('--tbl-line');
    if (!table.getAttribute('style')) table.removeAttribute('style');
  }

  /** Sort the body rows on the column holding `cell`. Numbers sort as numbers,
   *  everything else as text; blanks always sink to the bottom. Merged cells
   *  have no single row to move, so those tables are left alone. */
  function sortColumn(table, cell, dir = 'asc') {
    const g = gridOf(table);
    const at = locate(g, cell);
    if (!at) return false;
    if ([...table.querySelectorAll('th, td')].some(c => c.colSpan > 1 || c.rowSpan > 1)) return false;

    const skip = hasHeaderRow(table) ? 1 : 0;
    const body = g.rows.slice(skip);
    if (body.length < 2) return false;

    const textAt = row => (row.children[at.c]?.textContent || '').trim();
    const nums = body.map(textAt).map(t => (t === '' ? null : Number(t.replace(/[$,%\s]/g, ''))));
    const numeric = nums.every(n => n === null || Number.isFinite(n)) && nums.some(n => n !== null);

    const key = (row, i) => (numeric ? nums[i] : textAt(row).toLowerCase());
    const decorated = body.map((row, i) => ({ row, i, blank: textAt(row) === '', k: key(row, i) }));
    const sign = dir === 'desc' ? -1 : 1;
    decorated.sort((a, b) => {
      if (a.blank !== b.blank) return a.blank ? 1 : -1;          // blanks last, either way
      if (a.blank) return a.i - b.i;
      const cmp = numeric ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true });
      return cmp !== 0 ? sign * cmp : a.i - b.i;                 // stable
    });

    // Rows can live in a <thead>/<tbody> split; re-append each one where it is.
    for (const { row } of decorated) row.parentNode.appendChild(row);
    return true;
  }

  function newTable(rows, cols, withHeader = true) {
    const cell = t => `<${t}><br></${t}>`;
    const head = withHeader ? `<tr>${cell('th').repeat(cols)}</tr>` : '';
    const body = `<tr>${cell('td').repeat(cols)}</tr>`.repeat(Math.max(0, rows - (withHeader ? 1 : 0)));
    return `<table>${head}${body}</table>`;
  }

  return { gridOf, cellOf, tableOf, rowOf, insertRow, deleteRow, insertColumn, deleteColumn,
    mergeRight, mergeDown, isMerged, splitCell, toggleBorders, bordersOn, toggleHeaderRow,
    hasHeaderRow, moveToCell, newTable, MIN_COL, MIN_ROW, ensureColgroup, retotal, refit,
    columnIndex, positionOf, cellNear, columnWidth, setColumnWidth, rowHeight, setRowHeight,
    hasRowNumbers, toggleRowNumbers, lineColor, setLineColor, sortColumn };
})();

// ══ menu ════════════════════════════════════════════════════════════════════
// One shared context menu, used by the canvas, the editors and the tree.

const M_menu = (() => {
  const { $, el } = M_util;

  let box, closer;

  function showMenu(x, y, items) {
    box = box || $('#ctx');
    box.innerHTML = '';
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { box.append(el('hr')); continue; }
      if (it.hint) { box.append(el('div', { class: 'hint' }, it.hint)); continue; }
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

  function hideMenu() {
    if (!box) return;
    box.hidden = true;
    document.removeEventListener('pointerdown', closer, true);
    document.removeEventListener('keydown', escClose, true);
  }

  return { showMenu, hideMenu };
})();

// ══ store ═══════════════════════════════════════════════════════════════════
// Document state: the open note, undo/redo history, autosave, and reacting to
// edits made to the files outside the app.

const M_store = (() => {
  const { api } = M_api;
  const { parseNote, serializeNote, blankDoc } = M_format;
  const { stamp, debounce, stemOf, toast } = M_util;

  // Kept behind this tiny seam so app/test.html can exercise the real store
  // without writing fake note paths into the notebook origin's localStorage.
  let storage = localStorage;
  const useStorage = area => { storage = area; };

  const listeners = {};
  const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
  const fire = (evt, ...a) => (listeners[evt] || []).forEach(f => f(...a));

  const HISTORY_LIMIT = 250;
  const COALESCE_MS = 900;
  const KEEP_HISTORIES = 24;      // notes whose undo stack survives a switch
  const ACTION_LIMIT = 100;       // steps shown on the History page
  const ACTION_BYTES = 1.5e6;     // …and a ceiling on what that costs on disk

  /** Undo stacks parked by note path, so switching pages doesn't lose them. */
  const parked = new Map();

  const store = {
    path: null,
    doc: blankDoc('Untitled'),
    savedText: '',
    dirty: false,
    mutating: false,
    history: [],
    index: -1,
    coalesceUntil: 0,
    /** The History page's log: named steps, oldest first, saved beside the note. */
    actions: [],
    /** Set by canvas.js: flush contenteditable DOM back into the model. */
    sync: () => {},
    /** Set by canvas.js: describe / restore the caret across an undo. */
    readCaret: () => null,
    writeCaret: () => {},
  };

  /**
   * A fingerprint of what a note actually says, for "has this really changed?".
   * Pan, zoom and the modified stamp are left out — nobody *made* those changes
   * — and keys are sorted, because a document re-read from disk carries the same
   * fields in a different order and that is not an edit either.
   */
  const stable = value => JSON.stringify(value, (key, v) =>
    (v && typeof v === 'object' && !Array.isArray(v))
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
      : v);

  const contentKey = doc => stable({
    ...doc.meta, view: null, modified: null, elements: doc.elements,
  });

  // ── loading ───────────────────────────────────────────────────────────────

  /**
   * Every request to open a note supersedes the one before it. A path check is
   * not enough here: A → B → A can leave the first A read arriving after the
   * second, with the same path but older text and metadata.
   */
  let navigation = 0;
  const isCurrentNavigation = (token, path) =>
    token === navigation && (!path || store.path === path);

  async function open(path) {
    if (store.mutating) throw new Error("A file operation is still in progress");
    const token = ++navigation;
    try {
      await settleSaves();
      if (!isCurrentNavigation(token)) return false;

      const { text, mtime } = await api.read(path);
      if (!isCurrentNavigation(token)) return false;

      // The old note remains editable while its replacement is being read. If
      // something was typed in that interval, it still has to reach disk before
      // this request is allowed to replace the document.
      await settleSaves();
      if (!isCurrentNavigation(token)) return false;

      stale = false;                     // whatever moved under us, we re-read it
      flushActions.flush();                            // park the old note's log
      if (store.path && store.history.length) {
        parked.delete(store.path);                   // re-insert to keep it recent
        parked.set(store.path, { history: store.history, index: store.index });
        while (parked.size > KEEP_HISTORIES) parked.delete(parked.keys().next().value);
      }
      store.path = path;
      store.doc = parseNote(text, stemOf(path));
      store.savedText = text;
      store.savedContentKey = contentKey(store.doc);
      store.mtime = mtime;
      store.dirty = false;
      store.coalesceUntil = 0;
      store.actions = [];
      fire('actions');
      loadActions(path, token);

      const previous = parked.get(path);
      if (previous) {
        store.history = previous.history;
        store.index = previous.index;
        // The file may have moved on since; make the current state the newest step.
        if (store.history[store.index]?.snap !== JSON.stringify(store.doc)) pushSnapshot(null);
      } else {
        store.history = [];
        store.index = -1;
        pushSnapshot(null);
      }
      loadInto(store.doc);
      fire('state');
      storage.setItem('wb:last', path);
      return true;
    } catch (error) {
      // A failure from a request the user has already replaced is no longer the
      // result of their navigation. The current request owns any visible error.
      if (!isCurrentNavigation(token)) return false;
      throw error;
    }
  }

  // ── history ───────────────────────────────────────────────────────────────

  function pushSnapshot(caret) {
    store.history.length = store.index + 1;
    store.history.push({ snap: JSON.stringify(store.doc), caret });
    if (store.history.length > HISTORY_LIMIT) store.history.shift();
    store.index = store.history.length - 1;
  }

  /**
   * Record a new undo step. `coalesce` folds a continuous burst of typing into a
   * single step, so one ⌘Z undoes a word, not a letter. A `label` names the step
   * for the History page — and never coalesces, because folding a paste into the
   * typing that came before it is exactly how an undo loses someone's work.
   *
   *     commit()                      an edit; its own undo step
   *     commit({ coalesce: true })    typing; folds into the burst
   *     commit('Deleted a row')       a named step, listed on the History page
   */
  function commit(opts = {}) {
    if (loading) return;
    const { coalesce = false, label = '' } = typeof opts === 'string' ? { label: opts } : opts;
    store.sync();
    const snap = JSON.stringify(store.doc);
    const top = store.history[store.index];
    const unchanged = top && top.snap === snap;
    if (unchanged && !label) return;

    if (!unchanged) {
      const caret = store.readCaret();
      if (coalesce && !label && Date.now() < store.coalesceUntil && top) {
        store.history[store.index] = { snap, caret: top.caret };
      } else {
        pushSnapshot(caret);
      }
    }
    store.coalesceUntil = coalesce && !label ? Date.now() + COALESCE_MS : 0;
    if (label) logAction(label, snap);
    touch();
  }

  /**
   * Close the books before something destructive happens, so the state as it
   * stands is always its own undo step. Without this a paste that lands inside
   * the coalesce window of the typing before it overwrites that step instead of
   * adding one, and ⌘Z has nothing to go back to.
   */
  function beginAction() {
    if (loading) return;
    store.sync();
    store.coalesceUntil = 0;
    const snap = JSON.stringify(store.doc);
    if (store.history[store.index]?.snap !== snap) pushSnapshot(store.readCaret());
  }

  /** Run `fn` as one named, undoable step. */
  function act(label, fn) {
    beginAction();
    const out = fn ? fn() : undefined;
    commit({ label });
    return out;
  }

  // ── the action log ────────────────────────────────────────────────────────
  //
  // A plain-language record of the structural things done to this note — pasted,
  // deleted, recoloured, rows added — each carrying the whole document as it
  // stood afterwards, so the History page can jump back to any of them. Typing
  // is deliberately absent: it would bury everything else.

  let actionSeq = 0;

  function logAction(label, snap = JSON.stringify(store.doc)) {
    const last = store.actions[store.actions.length - 1];
    // A run of the same action on the same state is one step, not twenty.
    if (last && last.label === label && last.snap === snap) return;
    store.actions.push({
      id: `${Date.now().toString(36)}-${(actionSeq++).toString(36)}`,
      label, at: Date.now(), snap,
    });
    trimActions();
    fire('actions');
    queueActionSave();
  }

  function trimActions() {
    while (store.actions.length > ACTION_LIMIT) store.actions.shift();
    let bytes = store.actions.reduce((n, a) => n + a.snap.length, 0);
    while (store.actions.length > 1 && bytes > ACTION_BYTES) bytes -= store.actions.shift().snap.length;
  }

  /**
   * Whether a stored step is what the note looks like now. Compared on content:
   * panning the canvas or an autosave stamping `modified` is not a change
   * anybody made, and must not make every step on the History page look unvisited.
   */
  const keyOfSnap = snap => { try { return contentKey(JSON.parse(snap)); } catch { return null; } };
  const currentKey = () => { store.sync(); return contentKey(store.doc); };

  /** Put the note back the way it stood after `id`, as an undoable step. */
  function revertTo(id) {
    const target = store.actions.find(a => a.id === id);
    if (!target) return false;
    beginAction();
    if (keyOfSnap(target.snap) === currentKey()) return false;
    loadInto(JSON.parse(target.snap));
    pushSnapshot(null);
    logAction('Went back to “' + target.label + '”');
    touch();
    return true;
  }

  // Saved beside the note, under .history, so the log survives a restart.
  let pendingActions = null;
  /** The last log write, so something about to move the note can wait for it. */
  let actionWrite = Promise.resolve();
  const flushActions = debounce(() => {
    const job = pendingActions;
    pendingActions = null;
    if (job) actionWrite = api.setActions(job.path, job.actions).catch(() => {});
  }, 1500);

  function queueActionSave() {
    if (!store.path) return;
    pendingActions = { path: store.path, actions: store.actions.slice() };
    flushActions();
  }

  async function loadActions(path, token = navigation) {
    try {
      const { actions } = await api.actions(path);
      if (!isCurrentNavigation(token, path)) return;    // switched away while waiting
      const stored = (actions || []).filter(a => a && a.id && a.label && a.snap);
      // Anything logged while the fetch was in flight belongs after what was saved.
      store.actions = [...stored, ...store.actions];
      trimActions();
      if (!store.actions.length) logAction('Opened this page');
      fire('actions');
    } catch { /* the log is a convenience; never block the note on it */ }
  }

  /**
   * Swap a whole document in and tell everyone. Nothing may commit while this
   * runs: rebuilding the canvas rips out the focused editor, whose `blur` would
   * otherwise fire a commit that reads the *old* DOM straight back over the
   * document just restored — which is what used to make ⌘Z look like it did
   * nothing at all.
   */
  let loading = false;

  function loadInto(doc, caret = null) {
    loading = true;
    try {
      store.doc = doc;
      store.coalesceUntil = 0;
      fire('load', store.doc);
      if (caret) store.writeCaret(caret);
    } finally {
      loading = false;
    }
  }

  function restore(entry) {
    loadInto(JSON.parse(entry.snap), entry.caret);
    touch();
  }

  function undo() {
    store.sync();
    // An uncommitted edit is itself a step back to.
    if (JSON.stringify(store.doc) !== store.history[store.index]?.snap) commit();
    if (store.index <= 0) return false;
    restore(store.history[--store.index]);
    return true;
  }

  function redo() {
    if (store.index >= store.history.length - 1) return false;
    restore(store.history[++store.index]);
    return true;
  }

  const canUndo = () => store.index > 0;
  const canRedo = () => store.index < store.history.length - 1;

  // ── saving ────────────────────────────────────────────────────────────────
  //
  // A write describes one revision of one note. Two rules keep it that way:
  // writes are queued behind one another, so an older response can never land
  // after a newer one and put the older text back; and each write remembers the
  // note and the edit count it left with, so only *that* revision is booked as
  // saved. Anything typed while the request was away stays dirty and goes out
  // with the save that follows — which is the difference between an edit being
  // slow to reach disk and an edit being lost.

  /** Counts edits, so a returning write can tell whether it is already stale. */
  let revision = 0;
  /** Tail of the write queue. Kept un-rejectable: one failure must not jam it. */
  let queue = Promise.resolve();

  function touch() {
    revision++;
    store.dirty = !!store.path;            // nothing open: nowhere for it to go
    fire('state');
    if (store.dirty) autosave();
  }

  const autosave = debounce(() => { saveNow().catch(e => toast(e.message, true)); }, 700);

  /** Write the note as it stands, after every write already queued. */
  function saveNow() {
    autosave.cancel();
    const job = queue.then(write);
    queue = job.catch(() => {});
    return job;
  }

  async function write() {
    if (!store.path || stale) return;
    store.sync();
    const path = store.path;
    const at = revision;
    if (contentKey(store.doc) !== store.savedContentKey) store.doc.meta.modified = stamp();
    const text = serializeNote(store.doc);
    const key = contentKey(store.doc);
    if (text === store.savedText) { booked(path, at); return; }
    const res = await api.write(path, text);
    if (store.path !== path) return;    // switched notes mid-write; not ours now
    store.savedText = text;
    store.savedContentKey = key;
    store.mtime = res.mtime;
    booked(path, at);
    fire('saved');
  }

  /** Clean again — unless an edit arrived while the write was in flight. */
  function booked(path, at) {
    if (store.path !== path) return;
    store.dirty = at !== revision;
    if (store.dirty) autosave();
    fire('state');
  }

  /**
   * Everything this note owes the disk, written. Rejects if a save failed, so a
   * caller about to navigate away stops instead of walking off with the edits.
   */
  async function settleSaves() {
    do {
      await queue;
      if (!store.dirty || stale) return;
      await saveNow();
    } while (store.dirty && !stale);
  }

  /** Mark view-only changes (pan/zoom) — persisted, but never bump `modified`. */
  function touchView() {
    if (!store.path) return;
    revision++;
    store.dirty = true;
    fire('state');
    autosave();
  }

  // ── the file underneath ───────────────────────────────────────────────────
  //
  // Renaming, moving, trashing and restoring all move the file this store is
  // holding a document for, and they all take the same three steps: settle what
  // the note owes the disk, mutate the file, then put the store's idea of what
  // is open back in step. Mutating first is how a rename ends with the old name
  // recreated — by the save that was still in flight when the file moved — and
  // how a trashed note comes back, and how a restored version is overwritten a
  // moment later by the editor that never heard about it.

  const under = (path, root) => !!path && (path === root || path.startsWith(root + '/'));
  const rekeyed = (path, from, to) => to + path.slice(from.length);

  /**
   * Set when the file changed on disk beneath the open document — the server
   * rewrites a renamed note's title and image paths, and a restore replaces its
   * text outright. Nothing may be written back until it has been read again.
   */
  let stale = false;

  // Lock input before settling, through the filesystem mutation. The editor
  // stays inert until a moved/restored document has been read back successfully.
  const editingBlocked = () => store.mutating || stale;
  for (const type of ['beforeinput', 'keydown', 'paste', 'drop', 'pointerdown', 'click']) {
    window.addEventListener(type, event => {
      if (!store.mutating && !(stale && event.target?.closest?.('#editor'))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  async function lifecycle(change) {
    if (store.mutating) throw new Error('A file operation is still in progress');
    store.mutating = true;
    ++navigation;                     // invalidate reads started before the mutation
    fire('state');
    try { return await change(); }
    finally { store.mutating = false; fire('state'); }
  }

  /** Everything the open note owes the disk — its text and its action log. */
  async function settle() {
    flushActions.flush();
    await settleSaves();
    await actionWrite;
  }

  // A real reference to a sibling image — `src: images/x`, `src="images/x"` or
  // `](images/x)` — the same three shapes the server recognises. Prose that
  // merely names a path is not one.
  const IMG_REF = /(?:\bsrc\s*[:=]\s*|\]\(\s*)["']?images\//g;

  /**
   * Point an image reference at the file it is now. Names are tried longest
   * first, so `images/A11.png` is read as A11.png and never as A1.png with a
   * stray "1" left after it.
   */
  function retarget(text, renames, names) {
    if (typeof text !== 'string' || !names.length) return text;
    let out = '', pos = 0;
    IMG_REF.lastIndex = 0;
    for (let m; (m = IMG_REF.exec(text));) {
      const end = m.index + m[0].length;
      const name = names.find(n => text.startsWith(n, end));
      if (!name) continue;
      out += text.slice(pos, end) + renames[name];
      IMG_REF.lastIndex = pos = end + name.length;
    }
    return out + text.slice(pos);
  }

  const retargetDoc = (value, renames, names) =>
    typeof value === 'string' ? retarget(value, renames, names)
      : Array.isArray(value) ? value.map(v => retargetDoc(v, renames, names))
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value)
            .map(([k, v]) => [k, k === 'src' && typeof v === 'string' &&
              v.startsWith('images/') && Object.hasOwn(renames, v.slice(7))
                ? 'images/' + renames[v.slice(7)] : retargetDoc(v, renames, names)]))
        : value;

  /**
   * A snapshot taken before a rename, as the note stands after it: the server
   * moved the images and retitled the file, and a step restored from an undo
   * stack must not put back the names those files had. Snapshots are documents
   * stored as JSON; anything else is left exactly as it is.
   */
  function moved(snap, renames, names, title) {
    let doc;
    try { doc = JSON.parse(snap); } catch { return snap; }
    doc = retargetDoc(doc, renames, names);
    if (doc?.meta && typeof doc.meta.title === 'string') doc.meta.title = title;
    return JSON.stringify(doc);
  }

  /**
   * Rename or move a note or folder. Returns the path it ended up at (the
   * server may have made the name unique) and, if the open document was the
   * thing that moved or lived inside it, the path it is now at.
   */
  async function moveFile(from, to) {
    return lifecycle(async () => {
      await settle();
      const { path, images, title } = await api.rename(from, to);
      // What the server did to the note's images and title, so the snapshots
      // held in memory can be brought forward with the ones it rewrote on disk.
      const renames = images || {};
      const names = Object.keys(renames).sort((a, b) => b.length - a.length);
      // `title` is sent only when the thing that moved was a note; a folder
      // rename leaves its notes' own names, and so their references, untouched.
      const carry = typeof title === 'string'
        ? (snap => moved(snap, renames, names, title)) : null;
      for (const key of [...parked.keys()]) {
        if (!under(key, from)) continue;
        const stack = parked.get(key);
        if (carry && key === from) {
          stack.history = stack.history.map(e => ({ ...e, snap: carry(e.snap) }));
        }
        parked.set(rekeyed(key, from, path), stack);
        parked.delete(key);
      }
      if (under(pendingActions?.path, from)) {
        pendingActions.path = rekeyed(pendingActions.path, from, path);
        if (carry && pendingActions.path === path) {
          pendingActions.actions = pendingActions.actions
            .map(a => ({ ...a, snap: carry(a.snap) }));
        }
      }
      if (carry && store.path === from) {
        store.history = store.history.map(e => ({ ...e, snap: carry(e.snap) }));
        store.actions = store.actions.map(a => ({ ...a, snap: carry(a.snap) }));
      }
      if (!under(store.path, from)) return { path, active: null };
      store.path = rekeyed(store.path, from, path);
      stale = true;                        // the server rewrote it; read it again
      storage.setItem('wb:last', store.path);
      fire('state');
      return { path, active: store.path };
    });
  }

  /**
   * Move a note or folder to .trash, with whatever was pending written into it
   * first so the copy sitting in .trash is the whole of the work. Returns true
   * if the open document went with it, and is therefore no longer open.
   */
  async function trashFile(path) {
    return lifecycle(async () => {
      await settle();
      await api.remove(path);
      for (const key of [...parked.keys()]) if (under(key, path)) parked.delete(key);
      if (under(pendingActions?.path, path)) { flushActions.cancel(); pendingActions = null; }
      if (!under(store.path, path)) return false;
      close();
      return true;
    });
  }

  /**
   * Put a note back to one of its earlier versions. Pending edits are written
   * first, so the server's own snapshot of "what is there now" contains them
   * and the work being stepped away from stays recoverable.
   */
  async function restoreFile(path, at) {
    return lifecycle(async () => {
      await settle();
      await api.restore(path, at);
      if (under(store.path, path)) stale = true;             // reopen to see it
    });
  }

  /**
   * Nothing is open: the document that was here has gone to .trash. It must not
   * still be editable, and nothing may write it back to the name it no longer has.
   */
  function close() {
    autosave.cancel();
    stale = false;
    store.path = null;
    store.dirty = false;
    store.doc = blankDoc('Untitled');
    store.savedText = '';
    store.savedContentKey = contentKey(store.doc);
    store.mtime = 0;
    store.history = [];
    store.index = -1;
    store.actions = [];
    storage.removeItem('wb:last');
    fire('actions');
    loadInto(store.doc);
    fire('state');
  }

  // ── external file changes ─────────────────────────────────────────────────

  let lastPoll = Date.now() / 1000;
  let lastCount = -1;

  /** Reload the clean open note if this read still describes that exact visit. */
  async function reloadChanged(path = store.path) {
    if (!path || store.path !== path || !store.mtime || store.dirty) return false;
    const token = navigation;
    const mtime = store.mtime;
    const savedText = store.savedText;
    const fresh = await api.read(path);
    if (!isCurrentNavigation(token, path) || store.dirty ||
        store.mtime !== mtime || store.savedText !== savedText) return false;
    if (fresh.text === savedText) return false;

    const doc = parseNote(fresh.text, stemOf(path));
    store.doc = doc;
    store.savedText = fresh.text;
    store.savedContentKey = contentKey(doc);
    store.mtime = fresh.mtime;
    pushSnapshot(null);
    loadInto(doc);
    toast('Reloaded — changed on disk');
    return true;
  }

  function startWatching(onStructureChange) {
    setInterval(async () => {
      try {
        const { now, changed, count } = await api.changes(lastPoll);
        lastPoll = now;
        if (count !== lastCount) { lastCount = count; onStructureChange(); }
        if (!changed.length) return;
        if (changed.includes(store.path) && store.mtime && !store.dirty) {
          await reloadChanged(store.path);
        }
        onStructureChange();
      } catch { /* server restarting; try again next tick */ }
    }, 2500);
  }

  window.addEventListener('beforeunload', e => {
    // A fetch started here is abandoned; a beacon is handed to the browser to send.
    if (pendingActions && navigator.sendBeacon) {
      flushActions.cancel();
      navigator.sendBeacon('/api/actions', new Blob([JSON.stringify(pendingActions)],
        { type: 'application/json' }));
      pendingActions = null;
    } else {
      flushActions.flush();
    }
    if (store.dirty) { saveNow(); e.preventDefault(); e.returnValue = ''; }
  });

  return { on, store, open, commit, act, beginAction, logAction, revertTo, keyOfSnap,
    currentKey, undo, redo, canUndo, canRedo, saveNow, touchView, startWatching,
    reloadChanged, settle, moveFile, trashFile, restoreFile, useStorage, editingBlocked };
})();

// ══ richtext ════════════════════════════════════════════════════════════════
// Rich-text behaviour inside every `.rt` editor: formatting commands, paste
// rules, list/heading auto-transforms and the editor context menu.

const M_richtext = (() => {
  const { commit, act, beginAction, store } = M_store;
  const { showMenu } = M_menu;
  const { toast, rgbToHex } = M_util;
  const tbl = M_table;

  const URL_RE = /^(https?:\/\/|mailto:|file:\/\/)\S+$/i;

  let savedRange = null;
  let openNote = () => {};
  let elementItems = () => [];

  const setNoteOpener = fn => { openNote = fn; };
  /** Extra menu entries for the canvas element an editor belongs to. */
  const setElementItems = fn => { elementItems = fn; };

  // ── selection bookkeeping ─────────────────────────────────────────────────

  function saveRange() {
    const s = getSelection();
    if (s.rangeCount && s.anchorNode &&
        (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest?.('.rt')) {
      savedRange = s.getRangeAt(0).cloneRange();
    }
    return savedRange;
  }

  function restoreRange() {
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
  function hasSelection() {
    const host = activeEditor();
    if (!host) return false;
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed &&
        host.contains(sel.anchorNode) && host.contains(sel.focusNode)) return true;
    return !!(savedRange && !savedRange.collapsed && host.contains(savedRange.startContainer));
  }

  const activeEditor = () => {
    const a = document.activeElement;
    if (a?.classList?.contains('rt')) return a;
    const c = savedRange?.startContainer;
    const host = (c?.nodeType === 1 ? c : c?.parentElement)?.closest?.('.rt');
    return host?.isConnected ? host : null;
  };

  /** Forget the parked selection — called when focus leaves the text entirely. */
  function dropRange() { savedRange = null; }

  /** The table cell holding the caret, live or parked. Drives the table bar. */
  function caretCell() {
    const host = activeEditor();
    if (!host) return null;
    const sel = getSelection();
    let node = sel?.rangeCount ? sel.anchorNode : null;
    if (!node || !host.contains(node)) node = savedRange?.startContainer;
    if (!node || !host.contains(node)) return null;
    const cell = tbl.cellOf(node);
    return cell?.isConnected ? cell : null;
  }

  /** Put the caret inside `cell` so the table tools know what to act on. */
  function focusCell(cell) {
    const host = (cell.nodeType === 1 ? cell : cell.parentElement)?.closest?.('.rt');
    if (!host) return;
    host.focus();
    const r = document.createRange();
    r.selectNodeContents(cell);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    saveRange();
  }

  // ── commands ──────────────────────────────────────────────────────────────

  function exec(cmd, value = null, label = '') {
    if (!document.activeElement?.classList?.contains('rt')) restoreRange();
    if (label) beginAction();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    saveRange();
    commit(label ? { label } : {});
  }

  /**
   * Apply inline styles to the selection by wrapping each covered text node,
   * rather than the whole range at once — that keeps paragraphs, list items and
   * table cells intact when a selection crosses them.
   */
  function styleRange(props, label = '') {
    if (!hasSelection()) return false;
    restoreRange();
    if (label) beginAction();
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
    commit(label ? { label } : {});
    return true;
  }

  /** Collapse the span soup that repeated styling leaves behind: drop empty
   *  wrappers, drop wrappers whose only child already overrides them, and merge
   *  adjacent siblings that say the same thing. */
  function tidySpans(host) {
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

  const applyFontSize = px => styleRange({ fontSize: px + 'px' }, `Text size → ${px} px`);

  /** Strip character formatting and links, and flatten headings and quotes. */
  function clearFormatting() {
    if (!hasSelection()) return false;
    restoreRange();
    beginAction();
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
    commit('Cleared formatting');
    return true;
  }

  const applyTextColor = c => exec('foreColor', c, 'Text colour → ' + c);
  const applyHighlight = c => exec(c ? 'hiliteColor' : 'removeFormat', c || undefined,
    c ? 'Highlight → ' + c : 'Removed highlight');

  function insertHTML(html, label = '') {
    if (!document.activeElement?.classList?.contains('rt')) if (!restoreRange()) return false;
    if (label) beginAction();
    document.execCommand('insertHTML', false, html);
    commit(label ? { label } : {});
    return true;
  }

  function insertTable(rows, cols) {
    return insertHTML(tbl.newTable(rows, cols) + '<p><br></p>', `Inserted a ${rows} × ${cols} table`);
  }

  function makeLink(url) {
    if (!url) return;
    const s = getSelection();
    if (s && s.isCollapsed) insertHTML(`<a href="${url.replace(/"/g, '%22')}">${url}</a>`, 'Added a link');
    else exec('createLink', url, 'Added a link');
  }

  /** What the toolbar should light up for the current caret. */
  function queryState() {
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
  function sanitize(html) {
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

  /** How much text is about to be replaced — read before the paste lands. */
  function selectedLength() {
    const live = liveSelectionLength();
    if (live) return live;
    return savedRange && !savedRange.collapsed ? savedRange.toString().length : 0;
  }

  /** Only what is selected right now: no parked-range fallback, because a stale
   *  one would make a plain keystroke look like it wiped a paragraph. */
  function liveSelectionLength() {
    const sel = getSelection();
    return sel && sel.rangeCount && !sel.isCollapsed ? sel.toString().length : 0;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function pasteLabel(text, kind = '') {
    const over = selectedLength();
    return `Pasted ${plural((text || '').length, 'character')}${kind}` +
           (over ? `, replacing ${plural(over, 'character')}` : '');
  }

  function pastePlain(text) {
    const label = pasteLabel(text);
    const html = plainToHtml(text);
    if (html) { insertHTML(html, label); return; }
    beginAction();
    document.execCommand('insertText', false, text);
    commit({ label });
  }

  /** ⌘⇧V and the context-menu entry: keep the source formatting. */
  async function pasteFormatted() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text();
          const clean = sanitize(html);
          insertHTML(clean, pasteLabel(clean.replace(/<[^>]*>/g, ''), ' of formatted text'));
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
      exec('createLink', text, 'Linked the selected text');
      return;
    }
    ev.preventDefault();
    const html = data.getData('text/html');
    if (wantFormatting && html) {
      const clean = sanitize(html);
      insertHTML(clean, pasteLabel(clean.replace(/<[^>]*>/g, ''), ' of formatted text'));
    } else {
      pastePlain(data.getData('text/plain'));
    }
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

  function attachEditor(rt, elementId) {
    rt.addEventListener('input', ev => {
      if (autoTransform(rt, ev)) return;      // it commits once it has applied
      commit({ coalesce: true });
    });

    rt.addEventListener('paste', onPaste);

    // Cutting and deleting a selection are as destructive as pasting, and would
    // otherwise fold into the typing before them and take it down with them.
    rt.addEventListener('cut', () => {
      const n = liveSelectionLength();
      beginAction();
      setTimeout(() => commit(`Cut ${plural(n, 'character')}`), 0);
    });

    rt.addEventListener('blur', () => { saveRange(); commit(); });
    rt.addEventListener('keyup', saveRange);
    rt.addEventListener('mouseup', saveRange);

    rt.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); rt.blur(); return; }
      if (ev.key === 'Backspace' || ev.key === 'Delete') {
        const n = liveSelectionLength();
        if (n > 1) {
          beginAction();
          setTimeout(() => commit(`Deleted ${plural(n, 'character')}`), 0);
        }
        return;
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const anchor = getSelection().anchorNode;
        const cell = tbl.cellOf(anchor);
        if (cell) {
          // Tab walks the cells; tabbing off the last one adds a row.
          if (!tbl.moveToCell(cell, ev.shiftKey) && !ev.shiftKey) {
            const table = tbl.tableOf(cell);
            beginAction();
            tbl.insertRow(table, cell, true);
            tbl.refit(table);
            tbl.moveToCell(cell, false);
            commit('Added a table row');
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
      // Right-click anywhere in an editor — a text box, a sticky note, a table
      // cell, a selection — belongs to Paper. Option-click falls through to
      // Chrome's own menu, which is the only route to Inspect and to the
      // spelling suggestions: a page cannot open either one itself.
      if (ev.altKey) return;
      const cell = tbl.cellOf(ev.target);
      ev.preventDefault(); ev.stopPropagation();
      const sel = getSelection();
      // Right-clicking a cell the caret is not in should still target that cell.
      if (cell && !(sel?.rangeCount && cell.contains(sel.anchorNode))) focusCell(cell);
      else saveRange();
      const hasSel = sel && !sel.isCollapsed;
      const link = (sel?.anchorNode?.nodeType === 1 ? sel.anchorNode
                    : sel?.anchorNode?.parentElement)?.closest?.('a');
      const table = cell && tbl.tableOf(cell);
      // Every table edit is one named, undoable step, and re-fits the columns
      // once the shape of the grid has changed.
      const op = (name, fn) => () => act(name, () => { fn(); if (table) tbl.refit(table); });

      showMenu(ev.clientX, ev.clientY, [
        ...(table ? [
          { label: 'Insert row above',    run: op('Added a table row above', () => tbl.insertRow(table, cell, false)) },
          { label: 'Insert row below',    run: op('Added a table row below', () => tbl.insertRow(table, cell, true)) },
          { label: 'Insert column left',  run: op('Added a table column left', () => tbl.insertColumn(table, cell, false)) },
          { label: 'Insert column right', run: op('Added a table column right', () => tbl.insertColumn(table, cell, true)) },
          '-',
          { label: 'Delete row',    run: op('Deleted a table row', () => tbl.deleteRow(table, cell)) },
          { label: 'Delete column', run: op('Deleted a table column', () => tbl.deleteColumn(table, cell)) },
          { label: 'Delete table',  run: op('Deleted a table', () => table.remove()) },
          '-',
          { label: 'Merge with cell right', run: op('Merged table cells', () => {
              if (!tbl.mergeRight(table, cell)) toast('No matching cell to the right.'); }) },
          { label: 'Merge with cell below', run: op('Merged table cells', () => {
              if (!tbl.mergeDown(table, cell)) toast('No matching cell below.'); }) },
          tbl.isMerged(cell) && { label: 'Split cell', run: op('Split a table cell', () => tbl.splitCell(table, cell)) },
          '-',
          { label: tbl.bordersOn(table) ? 'Hide rules' : 'Show rules',
            run: op(tbl.bordersOn(table) ? 'Hid the table rules' : 'Showed the table rules',
                    () => tbl.toggleBorders(table)) },
          { label: tbl.hasHeaderRow(table) ? 'Remove header row' : 'Make header row',
            run: op(tbl.hasHeaderRow(table) ? 'Removed the header row' : 'Made a header row',
                    () => tbl.toggleHeaderRow(table)) },
          '-',
        ] : []),
        hasSel && { label: 'Cut', key: '⌘X',
                    run: () => {
                      restoreRange();
                      const n = selectedLength();          // gone once the cut lands
                      beginAction();
                      document.execCommand('cut');
                      commit(`Cut ${plural(n, 'character')}`);
                    } },
        hasSel && { label: 'Copy', key: '⌘C',
                    run: () => { restoreRange(); document.execCommand('copy'); } },
        { label: 'Paste', key: '⌘V', run: async () => {
            restoreRange();
            try { pastePlain(await navigator.clipboard.readText()); }
            catch { toast('The browser blocked clipboard access — use ⌘V.', true); } } },
        { label: 'Paste with formatting', key: '⌘⇧V', run: () => { restoreRange(); pasteFormatted(); } },
        { label: 'Select all', key: '⌘A', run: () => {
            rt.focus();
            const range = document.createRange();
            range.selectNodeContents(rt);
            const s = getSelection();
            s.removeAllRanges(); s.addRange(range);
            saveRange();
          } },
        '-',
        { label: link ? 'Edit link…' : 'Add link…', key: '⌘K', run: () => {
            restoreRange();
            const url = prompt('Link URL', link?.getAttribute('href') || 'https://');
            if (url) makeLink(url);
          } },
        link && { label: 'Remove link', run: () => { restoreRange(); exec('unlink', null, 'Removed a link'); } },
        '-',
        hasSel && { label: 'Clear formatting', key: '⌘\\', run: clearFormatting },
        ...(elementId ? elementItems(elementId) : []),
        '-',
        { hint: '⌥ right-click for the browser menu — Inspect, spelling' },
      ].filter(Boolean));
    });
  }

  return { setNoteOpener, setElementItems, saveRange, restoreRange, hasSelection, activeEditor, dropRange,
    caretCell, focusCell, exec, styleRange, tidySpans, applyFontSize, clearFormatting,
    applyTextColor, applyHighlight, insertHTML, insertTable, makeLink, queryState, sanitize,
    pastePlain, pasteFormatted, attachEditor };
})();

// ══ canvas ══════════════════════════════════════════════════════════════════
// The infinite canvas: pan/zoom viewport, element rendering, selection,
// dragging, resizing, box/line/ink tools and image placement.

const M_canvas = (() => {
  const { $, el, uid, clamp, toast, contrastOn } = M_util;
  const { store, commit, act, beginAction, touchView, on } = M_store;
  const { api, imageUrl } = M_api;
  const { attachEditor, dropRange } = M_richtext;

  const FONTS = {
    'Roboto':          "Roboto, system-ui, sans-serif",
    'JetBrains Mono':  "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    'Calibri':         "Calibri, Carlito, 'Segoe UI', sans-serif",
    'Arial':           "Arial, Helvetica, sans-serif",
    'Helvetica':       "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  };
  const fontStack = name => FONTS[name] || FONTS.Roboto;

  const HALO = '#4a86f7';
  const DOCK_SNAP = 18;      // screen px within which a connector end sticks

  const view = { x: 60, y: 40, scale: 1 };
  const selection = new Set();
  const style = {          // current tool style, remembered between shapes
    stroke: '#4a7fd4', fill: 'none', strokeWidth: 2,
    arrowStart: false, arrowEnd: true, shape: 'rect',
  };

  /** Per-shape defaults used when a new one is drawn. */
  const SHAPES = {
    rect:   { label: 'Rectangle',   w: 200, h: 120, radius: 6 },
    ellipse:{ label: 'Ellipse',     w: 200, h: 140, radius: 6 },
    sticky: { label: 'Sticky note', w: 180, h: 180, radius: 3,
              fill: '#ffe9a8', stroke: 'none', strokeWidth: 0 },
  };

  let stage, world, vector, overlay, hint;
  let tool = 'select';
  let nodes = new Map();
  const imagePaths = new Map();
  let marquee = null, spaceDown = false, lastPoint = { x: 120, y: 120 };
  let onChange = () => {};
  // While a connector is being drawn, every dockable shape shows its dots and
  // `dockHit` is the one the cursor is currently magnetised to.
  let docking = false, dockHit = null;

  const byId = id => store.doc.elements.find(e => e.id === id);
  const px = n => Math.round(n * 100) / 100;

  // ── coordinates ───────────────────────────────────────────────────────────

  function toWorld(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.scale,
             y: (clientY - r.top - view.y) / view.scale };
  }
  const toScreen = (x, y) => ({ x: view.x + x * view.scale, y: view.y + y * view.scale });

  function applyView() {
    world.style.transform = `translate(${px(view.x)}px, ${px(view.y)}px) scale(${px(view.scale)})`;
    drawOverlay();
    onChange();
  }

  function setZoom(scale, cx, cy) {
    const r = stage.getBoundingClientRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const next = clamp(scale, 0.1, 6);
    view.x = cx - (cx - view.x) * (next / view.scale);
    view.y = cy - (cy - view.y) * (next / view.scale);
    view.scale = next;
    applyView(); touchView();
  }

  const zoomBy = f => setZoom(view.scale * f);

  function contentBounds() {
    const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const e of store.doc.elements) {
      const r = boundsOf(e);
      b.x1 = Math.min(b.x1, r.x); b.y1 = Math.min(b.y1, r.y);
      b.x2 = Math.max(b.x2, r.x + r.w); b.y2 = Math.max(b.y2, r.y + r.h);
    }
    return isFinite(b.x1) ? b : { x1: 0, y1: 0, x2: 800, y2: 600 };
  }

  function fitToContent() {
    const b = contentBounds(), r = stage.getBoundingClientRect(), pad = 60;
    const s = clamp(Math.min((r.width - pad * 2) / Math.max(b.x2 - b.x1, 1),
                             (r.height - pad * 2) / Math.max(b.y2 - b.y1, 1)), 0.1, 1.6);
    view.scale = s;
    view.x = (r.width - (b.x2 - b.x1) * s) / 2 - b.x1 * s;
    view.y = (r.height - (b.y2 - b.y1) * s) / 2 - b.y1 * s;
    applyView(); touchView();
  }

  function centerOn(e) {
    const r = stage.getBoundingClientRect(), b = boundsOf(e);
    view.x = r.width / 2 - (b.x + b.w / 2) * view.scale;
    view.y = r.height / 3 - (b.y + b.h / 2) * view.scale;
    applyView();
  }

  function boundsOf(e) {
    if (e.type === 'line') {
      const { a, b } = lineEnds(e);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
               w: Math.abs(a.x - b.x) || 1, h: Math.abs(a.y - b.y) || 1 };
    }
    const n = nodes.get(e.id);
    return { x: e.x, y: e.y, w: e.w || 100,
             h: e.h || (n ? n.offsetHeight : 40) };
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  function render() {
    const seen = new Set();
    for (const e of store.doc.elements) {
      if (e.type === 'line' || e.type === 'ink') continue;
      seen.add(e.id);
      let n = nodes.get(e.id);
      if (!n) { n = makeNode(e); nodes.set(e.id, n); world.append(n); }
      updateNode(e, n);
    }
    for (const [id, n] of nodes) if (!seen.has(id)) { n.remove(); nodes.delete(id); }
    restack();
    renderVector();
    hint.hidden = store.doc.elements.some(e =>
      e.type !== 'text' || (e.html || '').replace(/<[^>]*>/g, '').trim());
    drawOverlay();
    onChange();
  }

  /**
   * Elements stack in document order, so bring-to-front and send-to-back are
   * really DOM moves. Only the nodes that are in the wrong place move: shifting
   * a node that is being typed in would throw the caret away.
   */
  function restack() {
    let prev = null;
    for (const e of store.doc.elements) {
      const n = nodes.get(e.id);
      if (!n) continue;                     // lines and ink live in the svg
      const want = prev ? prev.nextElementSibling : vector.nextElementSibling;
      if (n !== want) world.insertBefore(n, want);
      prev = n;
    }
  }

  function makeNode(e) {
    const rt = el('div', { class: 'rt', spellcheck: 'true' });
    if (e.type === 'image') {
      const node = el('div', { class: 'el image', 'data-id': e.id },
        el('img', { draggable: 'false', alt: e.src || '' }),
        el('div', { class: 'image-path', title: 'Local image file path' }));
      return node;
    }
    const node = el('div', { class: 'el ' + e.type, 'data-id': e.id }, rt);
    rt.contentEditable = 'true';
    attachEditor(rt, e.id);
    return node;
  }

  function updateNode(e, n) {
    const s = n.style;
    s.left = px(e.x) + 'px'; s.top = px(e.y) + 'px';
    s.width = px(e.w || 320) + 'px';
    s.fontFamily = fontStack(e.font || store.doc.meta.font);
    s.fontSize = (e.size || 16) + 'px';
    n.classList.toggle('sel', selection.has(e.id));

    if (e.type === 'text') { s.height = 'auto'; s.padding = '7px'; }
    if (e.type === 'box') {
      const sticky = e.shape === 'sticky';
      n.classList.toggle('sticky', sticky);
      n.classList.toggle('ellipse', e.shape === 'ellipse');
      s.height = px(e.h || 120) + 'px';
      s.borderWidth = (e.stroke === 'none' ? 0 : e.strokeWidth ?? 2) + 'px';
      s.borderColor = e.stroke && e.stroke !== 'none' ? e.stroke : 'transparent';
      s.background = e.fill && e.fill !== 'none' ? e.fill : 'transparent';
      s.borderRadius = e.shape === 'ellipse' ? '50%' : (e.radius ?? (sticky ? 3 : 6)) + 'px';
      // A filled box keeps its own contrast, whichever theme is on.
      s.color = (e.fill && e.fill !== 'none' && contrastOn(e.fill)) || '';
    }
    if (e.type === 'image') {
      s.height = px(e.h || 120) + 'px';
      const img = n.firstElementChild;
      const url = imageUrl(store.path || '', e.src || '');
      if (img.getAttribute('src') !== url) img.setAttribute('src', url);
      const caption = n.querySelector('.image-path');
      caption.hidden = e.showPath === false;
      if (!caption.hidden) paintImagePath(caption, store.path || '', e.src || '');
      return;
    }
    const rt = n.querySelector('.rt');
    const html = e.html || '<p><br></p>';
    if (rt && rt.innerHTML !== html) {
      // Rewriting a focused editor would drop the caret, so put it back.
      const caret = rt === document.activeElement ? readCaret() : null;
      rt.innerHTML = html;
      if (caret) writeCaret(caret);
    }
  }

  // ── vector layer (lines + ink) ────────────────────────────────────────────

  /** The four docking points on a shape, as fractions of its bounding box. */
  const PORTS = { n: [0.5, 0], e: [1, 0.5], s: [0.5, 1], w: [0, 0.5] };

  /** Shapes a connector can dock to: rectangles, ellipses and sticky notes. */
  const dockable = e => e.type === 'box';

  const portPoint = (r, port) =>
    ({ x: r.x + r.w * PORTS[port][0], y: r.y + r.h * PORTS[port][1] });

  /** The docking dot nearest the cursor, if it is within the magnet's reach. */
  function dockAt(clientX, clientY, skip) {
    const p = toWorld(clientX, clientY);
    let best = null, near = DOCK_SNAP / view.scale;
    for (const e of store.doc.elements) {
      if (!dockable(e) || e.id === skip) continue;
      const b = boundsOf(e);
      for (const port of Object.keys(PORTS)) {
        const q = portPoint(b, port);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < near) { near = d; best = { id: e.id, port }; }
      }
    }
    return best;
  }

  function rectOf(id) {
    const e = byId(id);
    if (!e) return null;
    const b = boundsOf(e);
    return { ...b, shape: e.shape, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
  }

  /** Where the centre-to-centre line leaves the shape's outline. */
  function clipToShape(r, from, toward) {
    const dx = toward.x - from.x, dy = toward.y - from.y;
    if (!dx && !dy) return from;
    const rx = r.w / 2 + 4, ry = r.h / 2 + 4;
    const t = r.shape === 'ellipse'
      ? 1 / Math.hypot(dx / rx, dy / ry)
      : Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
    return { x: from.x + dx * t, y: from.y + dy * t };
  }

  function lineEnds(l) {
    const ra = l.from ? rectOf(l.from) : null;
    const rb = l.to ? rectOf(l.to) : null;
    let a = ra ? (l.fromPort ? portPoint(ra, l.fromPort) : { x: ra.cx, y: ra.cy })
               : { x: l.x1 ?? 0, y: l.y1 ?? 0 };
    let b = rb ? (l.toPort ? portPoint(rb, l.toPort) : { x: rb.cx, y: rb.cy })
               : { x: l.x2 ?? 0, y: l.y2 ?? 0 };
    const a0 = { ...a }, b0 = { ...b };
    if (ra && !l.fromPort) a = clipToShape(ra, a0, b0);
    if (rb && !l.toPort)   b = clipToShape(rb, b0, a0);
    return { a, b };
  }

  /** How far behind the tip the arrowhead's base sits, as a fraction of size. */
  const ARROW_BASE = Math.abs(Math.cos(Math.PI * 0.83));

  /** A point `by` along the way from `tip` towards `other`. */
  function pullBack(tip, other, by) {
    const dx = other.x - tip.x, dy = other.y - tip.y;
    const len = Math.hypot(dx, dy);
    if (!len) return tip;
    const t = Math.min(by, len) / len;
    return { x: tip.x + dx * t, y: tip.y + dy * t };
  }

  function arrowHead(tip, from, size) {
    const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    const p = (d) => `${px(tip.x + size * Math.cos(ang + d))} ${px(tip.y + size * Math.sin(ang + d))}`;
    return `M${px(tip.x)} ${px(tip.y)} L${p(Math.PI * 0.83)} L${p(-Math.PI * 0.83)} Z`;
  }

  function renderVector() {
    const out = [];
    for (const e of store.doc.elements) {
      const on = selection.has(e.id);
      const w = e.strokeWidth ?? 2, color = e.stroke || '#4a7fd4';
      if (e.type === 'ink') {
        const sx = e.bw ? (e.w || e.bw) / e.bw : 1, sy = e.bh ? (e.h || e.bh) / e.bh : 1;
        const tf = `translate(${px(e.x)} ${px(e.y)}) scale(${px(sx)} ${px(sy)})`;
        if (on) out.push(`<path transform="${tf}" d="${e.d}" fill="none" stroke="${HALO}" stroke-opacity=".45" stroke-width="${w + 8}" stroke-linecap="round"/>`);
        out.push(`<path transform="${tf}" d="${e.d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
        out.push(`<path class="hit" data-id="${e.id}" transform="${tf}" d="${e.d}"/>`);
      } else if (e.type === 'line') {
        const { a, b } = lineEnds(e);
        const head = Math.max(9, w * 3.4);
        // The round cap would peep out past the arrow's point as a dot, so the
        // stroke stops at the head's base and the triangle finishes the line.
        const a2 = e.arrowStart ? pullBack(a, b, head * ARROW_BASE) : a;
        const b2 = e.arrowEnd   ? pullBack(b, a, head * ARROW_BASE) : b;
        const d = `M${px(a2.x)} ${px(a2.y)} L${px(b2.x)} ${px(b2.y)}`;
        const hit = `M${px(a.x)} ${px(a.y)} L${px(b.x)} ${px(b.y)}`;
        if (on) out.push(`<path d="${d}" fill="none" stroke="${HALO}" stroke-opacity=".45" stroke-width="${w + 8}" stroke-linecap="round"/>`);
        out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`);
        if (e.arrowEnd)   out.push(`<path d="${arrowHead(b, a, head)}" fill="${color}"/>`);
        if (e.arrowStart) out.push(`<path d="${arrowHead(a, b, head)}" fill="${color}"/>`);
        out.push(`<path class="hit" data-id="${e.id}" d="${hit}"/>`);
      }
    }
    vector.innerHTML = out.join('');
  }

  // ── selection + overlay ───────────────────────────────────────────────────

  function select(ids, additive = false) {
    if (!additive) selection.clear();
    for (const id of [].concat(ids)) if (id) selection.add(id);
    for (const [id, n] of nodes) n.classList.toggle('sel', selection.has(id));
    renderVector(); drawOverlay(); onChange();
  }

  /** Lift elements to the top of the stack, or drop them to the bottom. */
  function stackTo(elements, toFront) {
    const moving = new Set(elements);
    if (!moving.size) return;
    const rest = store.doc.elements.filter(e => !moving.has(e));
    store.doc.elements = toFront ? [...rest, ...elements] : [...elements, ...rest];
    render(); commit(`${toFront ? 'Brought' : 'Sent'} ${nameOf(elements)} to ${toFront ? 'front' : 'back'}`);
  }

  const clearSelection = () => select([]);
  const selected = () => [...selection].map(byId).filter(Boolean);

  /** How the History page names a canvas element: "a box", "3 connectors". */
  const KIND = { text: 'text box', box: 'box', image: 'image', line: 'connector', ink: 'drawing' };
  const kindOf = e => KIND[e.type] || 'object';
  const nameOf = list => {
    if (list.length === 1) {
      const what = kindOf(list[0]);
      return (/^[aeiou]/.test(what) ? 'an ' : 'a ') + what;
    }
    const kinds = new Set(list.map(kindOf));
    return `${list.length} ${kinds.size === 1 ? [...kinds][0] + 's' : 'objects'}`;
  };

  const HANDLES = { text: ['e', 'w'], box: ['nw','n','ne','e','se','s','sw','w'],
                    image: ['nw','ne','se','sw'], ink: ['nw','ne','se','sw'] };

  function drawOverlay() {
    overlay.innerHTML = '';
    if (marquee) {
      overlay.append(el('div', { class: 'marquee', style: {
        left: marquee.x + 'px', top: marquee.y + 'px',
        width: marquee.w + 'px', height: marquee.h + 'px' } }));
    }
    if (docking) {
      for (const e of store.doc.elements) {
        if (!dockable(e)) continue;
        const b = boundsOf(e);
        for (const port of Object.keys(PORTS)) {
          const q = portPoint(b, port), s = toScreen(q.x, q.y);
          const lit = dockHit && dockHit.id === e.id && dockHit.port === port;
          overlay.append(el('div', { class: 'dock' + (lit ? ' on' : ''),
            style: { left: s.x + 'px', top: s.y + 'px' } }));
        }
      }
    }
    for (const e of selected()) {
      if (e.type === 'line') {
        const { a, b } = lineEnds(e);
        for (const [k, p] of [['a', a], ['b', b]]) {
          const s = toScreen(p.x, p.y);
          overlay.append(el('div', { class: 'handle endpoint', 'data-id': e.id,
            'data-end': k, style: { left: s.x + 'px', top: s.y + 'px' } }));
        }
        continue;
      }
      const b = boundsOf(e), tl = toScreen(b.x, b.y);
      const w = b.w * view.scale, h = b.h * view.scale;
      if (e.type !== 'text' || selection.size > 1) {
        overlay.append(el('div', { class: 'selbox', style: {
          left: tl.x + 'px', top: tl.y + 'px', width: w + 'px', height: h + 'px' } }));
      }
      // Resize and move handles would sit on top of the docking dots, so while a
      // connector is in play they stand aside and let the magnets have the edges.
      if (docking) continue;
      // One obvious thing to grab: a knob above the top edge that only moves.
      overlay.append(el('div', { class: 'handle grab', 'data-id': e.id, 'data-grab': '1',
        title: 'Drag to move', style: { left: (tl.x + w / 2) + 'px', top: (tl.y - 17) + 'px' } }));
      for (const dir of HANDLES[e.type] || []) {
        const fx = dir.includes('w') ? 0 : dir.includes('e') ? 1 : 0.5;
        const fy = dir.includes('n') ? 0 : dir.includes('s') ? 1 : 0.5;
        // Keep width grips on the visible part of a tall section as it scrolls.
        const top = Math.max(12, tl.y), bottom = Math.min(stage.clientHeight - 12, tl.y + h);
        const handleY = (dir === 'e' || dir === 'w') && bottom >= top
          ? (top + bottom) / 2 : tl.y + h * fy;
        const handleX = dir === 'e' && tl.x < 12 && tl.x + w > stage.clientWidth - 12
          ? stage.clientWidth - 24 : tl.x + w * fx;
        overlay.append(el('div', { class: 'handle', 'data-id': e.id, 'data-dir': dir,
          title: 'Drag to resize',
          style: { left: handleX + 'px', top: handleY + 'px' } }));
      }
    }
  }

  // ── mutation helpers ──────────────────────────────────────────────────────

  function addElement(e) {
    store.doc.elements.push(e);
    render();
    return e;
  }

  function removeSelected() {
    if (!selection.size) return;
    const label = 'Deleted ' + nameOf(selected());
    const dead = new Set(selection);
    beginAction();
    store.doc.elements = store.doc.elements.filter(e =>
      !dead.has(e.id) && !(e.type === 'line' && (dead.has(e.from) || dead.has(e.to))));
    clearSelection();
    render(); commit(label);
  }

  function duplicateSelected() {
    const copies = selected().map(e => ({ ...e, id: uid(e.type[0]), x: e.x + 24, y: e.y + 24,
      from: undefined, to: undefined, fromPort: undefined, toPort: undefined }));
    store.doc.elements.push(...copies);
    render(); select(copies.map(c => c.id)); commit('Duplicated ' + nameOf(copies));
  }

  function applyToSelection(patch, label = '') {
    const hit = selected();
    if (!hit.length) return false;
    for (const e of hit) Object.assign(e, patch);
    render();
    commit(label ? { label: `${label} on ${nameOf(hit)}` } : {});
    return true;
  }

  function createText(x, y, w = 340) {
    const e = addElement({ id: uid('t'), type: 'text', x: px(x), y: px(y), w, html: '<p><br></p>' });
    select(e.id);
    const rt = nodes.get(e.id)?.querySelector('.rt');
    if (rt) { rt.focus(); placeCaretEnd(rt); }
    commit('Added a text box');
    return e;
  }

  async function placeImage(blob, at) {
    if (!store.path) return;
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const { src } = await api.upload(store.path, ext, blob);
    const url = URL.createObjectURL(blob);
    const dims = await new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 320, h: 240 });
      img.src = url;
    });
    URL.revokeObjectURL(url);
    const scale = Math.min(1, 520 / dims.w);
    const p = at || lastPoint;
    const e = addElement({ id: uid('i'), type: 'image', x: px(p.x), y: px(p.y),
      w: Math.round(dims.w * scale), h: Math.round(dims.h * scale), src });
    select(e.id); commit('Added an image');
    toast('Saved ' + src);
    return e;
  }

  function fallbackImagePath(notePath, src) {
    if (/^(?:https?:|data:|blob:|\/)/.test(src)) return src;
    const folder = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '';
    return 'notes/' + folder + src;
  }

  async function resolveImagePath(notePath, src) {
    const key = notePath + '\n' + src;
    if (imagePaths.has(key)) return imagePaths.get(key);
    if (/^(?:https?:|data:|blob:|\/)/.test(src)) return src;
    try {
      const value = (await api.imagePath(notePath, src)).path;
      imagePaths.set(key, value);
      return value;
    } catch {
      return fallbackImagePath(notePath, src);
    }
  }

  function paintImagePath(caption, notePath, src) {
    const fallback = fallbackImagePath(notePath, src);
    if (caption.dataset.key === notePath + '\n' + src && caption.textContent) return;
    caption.dataset.key = notePath + '\n' + src;
    caption.textContent = fallback;
    caption.title = fallback;
    resolveImagePath(notePath, src).then(path => {
      if (caption.dataset.key !== notePath + '\n' + src) return;
      caption.textContent = path;
      caption.title = path;
    });
  }

  function setImagePathVisible(id, visible) {
    const image = byId(id);
    if (!image || image.type !== 'image') return;
    image.showPath = !!visible;
    render(); commit(visible ? 'Showed an image path' : 'Hid an image path');
  }

  async function copyImagePath(id) {
    const image = byId(id);
    if (!image || image.type !== 'image') return;
    const path = await resolveImagePath(store.path || '', image.src || '');
    await navigator.clipboard.writeText(path);
    toast('Copied image file path');
  }

  /** A free-ish spot in the visible viewport to drop something new. */
  function viewportAnchor() {
    const r = stage.getBoundingClientRect();
    const at = toWorld(r.left + r.width * 0.28, r.top + r.height * 0.3);
    const taken = p => store.doc.elements.some(e => {
      const b = boundsOf(e);
      return p.x > b.x - 40 && p.x < b.x + b.w && p.y > b.y - 40 && p.y < b.y + b.h;
    });
    for (let i = 0; i < 12 && taken(at); i++) { at.x += 32; at.y += 32; }
    return { x: px(at.x), y: px(at.y) };
  }

  const editorFor = id => nodes.get(id)?.querySelector('.rt') || null;

  function placeCaretEnd(host) {
    const r = document.createRange();
    r.selectNodeContents(host); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  // ── DOM <-> model sync ────────────────────────────────────────────────────

  let rebuilding = false;

  function syncDom() {
    if (rebuilding) return;                  // the nodes are mid-rebuild; they lie
    for (const e of store.doc.elements) {
      const n = nodes.get(e.id);
      if (!n) continue;
      if (e.type === 'text' || e.type === 'box') {
        const rt = n.querySelector('.rt');
        if (rt) e.html = rt.innerHTML;
      }
      if (e.type === 'text') e.h = Math.round(n.offsetHeight);
    }
    store.doc.meta.view = { x: px(view.x), y: px(view.y), scale: px(view.scale) };
  }

  function readCaret() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const anchor = sel.anchorNode;
    const host = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest?.('.rt');
    if (!host) return null;
    const probe = document.createRange();
    probe.selectNodeContents(host);
    probe.setEnd(sel.anchorNode, sel.anchorOffset);
    return { id: host.closest('.el').dataset.id, offset: probe.toString().length };
  }

  function writeCaret(c) {
    const host = nodes.get(c.id)?.querySelector('.rt');
    if (!host) return;
    host.focus();
    const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let n, left = c.offset;
    while ((n = walk.nextNode())) {
      if (left <= n.length) {
        const r = document.createRange();
        r.setStart(n, left); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return;
      }
      left -= n.length;
    }
    placeCaretEnd(host);
  }

  // ── tools ─────────────────────────────────────────────────────────────────

  function setTool(name) {
    tool = name;
    docking = name === 'line';
    stage.dataset.tool = name;
    if (stage.isConnected) drawOverlay();
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
    onChange();
  }
  const getTool = () => tool;

  function drag(ev, onMove, onEnd) {
    ev.preventDefault();
    const sx = ev.clientX, sy = ev.clientY;
    let moved = false;
    const move = m => {
      if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 2) moved = true;
      onMove(m, (m.clientX - sx) / view.scale, (m.clientY - sy) / view.scale, moved);
    };
    const up = m => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd?.(m, moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function panFrom(ev) {
    const ox = view.x, oy = view.y;
    stage.classList.add('panning');
    drag(ev, m => {
      view.x = ox + (m.clientX - ev.clientX);
      view.y = oy + (m.clientY - ev.clientY);
      applyView();
    }, () => { stage.classList.remove('panning'); touchView(); });
  }

  function moveSelection(ev) {
    const start = selected().map(e => ({ e, x: e.x, y: e.y,
      x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }));
    drag(ev, (m, dx, dy) => {
      const snap = m.shiftKey ? v => Math.round(v / 8) * 8 : v => v;
      for (const s of start) {
        if (s.e.type === 'line') {
          // A docked end stays put; only the loose ones travel.
          if (!s.e.from) { s.e.x1 = px(snap(s.x1 + dx)); s.e.y1 = px(snap(s.y1 + dy)); }
          if (!s.e.to)   { s.e.x2 = px(snap(s.x2 + dx)); s.e.y2 = px(snap(s.y2 + dy)); }
          continue;
        }
        s.e.x = px(snap(s.x + dx)); s.e.y = px(snap(s.y + dy));
        const n = nodes.get(s.e.id);
        if (n) { n.style.left = s.e.x + 'px'; n.style.top = s.e.y + 'px'; }
      }
      renderVector(); drawOverlay();
    }, (m, moved) => { if (moved) commit('Moved ' + nameOf(selected())); });
  }

  function resizeFrom(ev, e, dir) {
    const o = { x: e.x, y: e.y, w: e.w || 100, h: e.h || boundsOf(e).h };
    const ratio = o.h / Math.max(o.w, 1);
    drag(ev, (m, dx, dy) => {
      let { x, y, w, h } = o;
      if (dir.includes('e')) w = o.w + dx;
      if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
      if (dir.includes('s')) h = o.h + dy;
      if (dir.includes('n')) { h = o.h - dy; y = o.y + dy; }
      if ((e.type === 'image' || e.type === 'ink') && dir.length === 2 && !m.altKey) {
        h = Math.max(12, w * ratio);
        if (dir.includes('n')) y = o.y + (o.h - h);
      }
      e.x = px(x); e.y = px(y);
      e.w = px(Math.max(24, w));
      if (e.type !== 'text') e.h = px(Math.max(16, h));
      const n = nodes.get(e.id);
      if (n) updateNode(e, n);
      renderVector(); drawOverlay();
    }, (m, moved) => { if (moved) { render(); commit('Resized ' + nameOf([e])); } });
  }

  function moveEndpoint(ev, e, end) {
    docking = true;
    drag(ev, m => {
      dockHit = dockAt(m.clientX, m.clientY, e.id);
      attachEnd(e, end, m, dockHit);
      renderVector(); drawOverlay();
    }, (m, moved) => {
      docking = tool === 'line'; dockHit = null;
      drawOverlay();
      if (moved) commit('Moved a connector end');
    });
  }

  /**
   * Point one end of `l` at wherever the cursor is: a docking dot wins, then the
   * body of a shape, and otherwise the end floats free — pull it off a dot and
   * the magnet lets go.
   */
  function attachEnd(l, end, m, dock) {
    const id = end === 'a' ? 'from' : 'to';
    const port = end === 'a' ? 'fromPort' : 'toPort';
    const other = end === 'a' ? l.to : l.from;
    if (dock && dock.id !== other) { l[id] = dock.id; l[port] = dock.port; return; }
    const over = elementAt(m.clientX, m.clientY, l.id);
    if (over && over !== other) { l[id] = over; l[port] = undefined; return; }
    l[id] = undefined; l[port] = undefined;
    const p = toWorld(m.clientX, m.clientY);
    if (end === 'a') { l.x1 = px(p.x); l.y1 = px(p.y); }
    else             { l.x2 = px(p.x); l.y2 = px(p.y); }
  }

  /**
   * Step out of whichever editor holds the caret. Selecting a shape has to take
   * the keyboard with it, or ⌫ still goes to the text the user last typed in.
   */
  function leaveText() {
    const a = document.activeElement;
    if (a?.classList?.contains('rt')) a.blur();
    dropRange();
  }

  /** Topmost box/text/image under the cursor, ignoring `skip`. */
  function elementAt(cx, cy, skip) {
    const hit = document.elementFromPoint(cx, cy)?.closest?.('.el');
    const id = hit?.dataset.id;
    return id && id !== skip ? id : null;
  }

  // ── pointer routing ───────────────────────────────────────────────────────

  function onPointerDown(ev) {
    if (ev.button === 1 || (ev.button === 0 && (spaceDown || tool === 'pan'))) return panFrom(ev);
    if (ev.button !== 0) return;

    // Hit-test by coordinate rather than by event target: the topmost thing under
    // the cursor is what the user meant, whatever swallowed the event.
    const under = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;

    const handle = under.closest?.('.handle');
    if (handle) {
      const e = byId(handle.dataset.id);
      if (!e) return;
      if (handle.dataset.grab) {
        if (!selection.has(e.id)) select(e.id);
        leaveText();
        return moveSelection(ev);
      }
      return handle.dataset.end ? moveEndpoint(ev, e, handle.dataset.end)
                                : resizeFrom(ev, e, handle.dataset.dir);
    }

    const hitPath = under.closest?.('path.hit');
    const node = under.closest?.('.el');
    lastPoint = toWorld(ev.clientX, ev.clientY);

    if (tool === 'pen')  return drawInk(ev);
    if (tool === 'box')  return dragNewBox(ev);
    if (tool === 'line') return dragNewLine(ev, node?.dataset.id);
    if (tool === 'text' && !node) {
      createText(lastPoint.x, lastPoint.y); setTool('select'); return;
    }

    if (hitPath) {
      const id = hitPath.dataset.id;
      if (selection.has(id) && ev.shiftKey) { selection.delete(id); select([...selection]); return; }
      if (!selection.has(id)) select(id, ev.shiftKey);
      leaveText();
      return moveSelection(ev);          // a selected line drags around like a box
    }

    if (node) {
      const id = node.dataset.id;
      const inText = under.closest('.rt') && node.classList.contains('sel');
      const editable = under.closest('.rt') && node.classList.contains('text');
      if (!selection.has(id)) select(id, ev.shiftKey);
      else if (ev.shiftKey) { selection.delete(id); select([...selection]); return; }
      if (ev.altKey || (!inText && !editable)) {
        ev.preventDefault();
        leaveText();                   // so ⌫ deletes the shape, not the old text
        moveSelection(ev);
      }
      return;
    }

    // empty canvas
    leaveText();                       // the caret is no longer anywhere useful
    if (!ev.shiftKey) clearSelection();
    startMarquee(ev);
  }

  function startMarquee(ev) {
    const r = stage.getBoundingClientRect();
    const ox = ev.clientX - r.left, oy = ev.clientY - r.top;
    const base = new Set(selection);
    drag(ev, m => {
      const cx = m.clientX - r.left, cy = m.clientY - r.top;
      marquee = { x: Math.min(ox, cx), y: Math.min(oy, cy),
                  w: Math.abs(cx - ox), h: Math.abs(cy - oy) };
      const a = toWorld(Math.min(ev.clientX, m.clientX), Math.min(ev.clientY, m.clientY));
      const b = toWorld(Math.max(ev.clientX, m.clientX), Math.max(ev.clientY, m.clientY));
      const hits = store.doc.elements.filter(e => {
        const r2 = boundsOf(e);
        return r2.x < b.x && r2.x + r2.w > a.x && r2.y < b.y && r2.y + r2.h > a.y;
      }).map(e => e.id);
      select([...base, ...hits]);
    }, () => { marquee = null; drawOverlay(); });
  }

  function dragNewBox(ev) {
    const p = toWorld(ev.clientX, ev.clientY);
    const kind = SHAPES[style.shape] ? style.shape : 'rect';
    const preset = SHAPES[kind];
    const e = addElement({ id: uid('b'), type: 'box', shape: kind === 'rect' ? undefined : kind,
      x: px(p.x), y: px(p.y), w: 8, h: 8,
      fill: preset.fill ?? style.fill,
      stroke: preset.stroke ?? style.stroke,
      strokeWidth: preset.strokeWidth ?? style.strokeWidth,
      radius: preset.radius ?? 6, html: '<p><br></p>' });
    drag(ev, (m, dx, dy) => {
      if (m.shiftKey) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx) * s; dy = Math.sign(dy) * s; }
      e.x = px(Math.min(p.x, p.x + dx)); e.y = px(Math.min(p.y, p.y + dy));
      e.w = px(Math.max(12, Math.abs(dx))); e.h = px(Math.max(12, Math.abs(dy)));
      updateNode(e, nodes.get(e.id)); drawOverlay();
    }, (m, moved) => {
      if (!moved) { e.w = preset.w; e.h = preset.h; }
      render(); select(e.id); commit(`Added a ${SHAPES[e.shape]?.label.toLowerCase() || 'box'}`);
      setTool('select');
    });
  }

  function dragNewLine(ev, fromId) {
    const p = toWorld(ev.clientX, ev.clientY);
    const start = dockAt(ev.clientX, ev.clientY);
    const anchor = start ? { from: start.id, fromPort: start.port }
                 : fromId ? { from: fromId }
                 : { x1: px(p.x), y1: px(p.y) };
    const e = addElement({ id: uid('l'), type: 'line', ...anchor,
      x2: px(p.x), y2: px(p.y),
      stroke: style.stroke, strokeWidth: style.strokeWidth,
      arrowStart: style.arrowStart, arrowEnd: style.arrowEnd });
    docking = true;
    drag(ev, m => {
      dockHit = dockAt(m.clientX, m.clientY, e.id);
      if (!dockHit && !elementAt(m.clientX, m.clientY, e.id) && m.shiftKey) {
        // Free end, shift held: straighten it to the nearer axis.
        const q = toWorld(m.clientX, m.clientY);
        const ax = Math.abs(q.x - p.x), ay = Math.abs(q.y - p.y);
        e.to = undefined; e.toPort = undefined;
        e.x2 = px(ax > ay * 2 ? q.x : ay > ax * 2 ? p.x : q.x);
        e.y2 = px(ax > ay * 2 ? p.y : q.y);
      } else {
        attachEnd(e, 'b', m, dockHit);
      }
      renderVector(); drawOverlay();
    }, (m, moved) => {
      docking = tool === 'line'; dockHit = null;
      const { a, b } = lineEnds(e);
      if (!moved || (Math.hypot(b.x - a.x, b.y - a.y) < 8 && !e.to)) {
        store.doc.elements = store.doc.elements.filter(x => x !== e);
        render(); return;
      }
      drawOverlay();
      render(); select(e.id); commit('Added a connector'); setTool('select');
    });
  }

  function drawInk(ev) {
    const p = toWorld(ev.clientX, ev.clientY);
    const pts = [p];
    const e = addElement({ id: uid('k'), type: 'ink', x: 0, y: 0, w: 1, h: 1, bw: 1, bh: 1,
      stroke: style.stroke, strokeWidth: style.strokeWidth, d: `M${px(p.x)} ${px(p.y)}` });
    drag(ev, m => {
      const q = toWorld(m.clientX, m.clientY);
      const last = pts[pts.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) < 1.2 / view.scale) return;
      pts.push(q);
      e.d = smoothPath(pts);
      renderVector();
    }, (m, moved) => {
      if (!moved && pts.length < 2) {
        store.doc.elements = store.doc.elements.filter(x => x !== e); render(); return;
      }
      // Re-base the path on its own bounding box so the stroke can be moved/scaled.
      const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
      const pad = (e.strokeWidth || 2) / 2 + 1;
      const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
      e.x = px(x0); e.y = px(y0);
      e.bw = e.w = px(Math.max(...xs) - Math.min(...xs) + pad * 2);
      e.bh = e.h = px(Math.max(...ys) - Math.min(...ys) + pad * 2);
      e.d = smoothPath(pts.map(q => ({ x: q.x - x0, y: q.y - y0 })));
      render(); commit('Drew a stroke');
    });
  }

  /** Quadratic smoothing through midpoints — cheap and looks like ink. */
  function smoothPath(pts) {
    if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x)} ${px(p.y)}`).join(' ');
    let d = `M${px(pts[0].x)} ${px(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q${px(pts[i].x)} ${px(pts[i].y)} ${px(mx)} ${px(my)}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L${px(last.x)} ${px(last.y)}`;
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  function mount(opts = {}) {
    stage = $('#stage'); world = $('#world'); vector = $('#vector');
    overlay = $('#overlay'); hint = $('#empty-hint');
    onChange = opts.onChange || (() => {});

    store.sync = syncDom;
    store.readCaret = readCaret;
    store.writeCaret = writeCaret;

    setTool('select');
    applyView();

    stage.addEventListener('pointerdown', onPointerDown);

    stage.addEventListener('dblclick', ev => {
      if (ev.target.closest('.el') || ev.target.closest('.handle')) return;
      const p = toWorld(ev.clientX, ev.clientY);
      createText(p.x - 8, p.y - 14);
    });

    stage.addEventListener('wheel', ev => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const r = stage.getBoundingClientRect();
        setZoom(view.scale * Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top);
      } else {
        view.x -= ev.deltaX; view.y -= ev.deltaY;
        applyView(); touchView();
      }
    }, { passive: false });

    window.addEventListener('keydown', ev => { if (ev.code === 'Space' && !isTyping()) spaceDown = true; });
    window.addEventListener('keyup',   ev => { if (ev.code === 'Space') spaceDown = false; });
    window.addEventListener('blur',    () => { spaceDown = false; });
    window.addEventListener('resize', drawOverlay);

    on('load', () => {
      rebuilding = true;
      try {
        nodes.forEach(n => n.remove());
        nodes.clear();
        selection.clear();
        const v = store.doc.meta.view;
        if (v && isFinite(v.scale)) { view.x = v.x; view.y = v.y; view.scale = v.scale || 1; }
        applyView();
        render();
      } finally {
        rebuilding = false;
      }
    });
  }

  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
  };

  return { nodes, FONTS, fontStack, view, selection, style, SHAPES, toWorld, setZoom, zoomBy,
    contentBounds, fitToContent, centerOn, render, lineEnds, select, clearSelection, selected, stackTo,
    addElement, removeSelected, duplicateSelected, applyToSelection, createText, placeImage,
    setImagePathVisible, copyImagePath, viewportAnchor, editorFor, setTool, getTool, mount,
    isTyping };
})();

// ══ minimap ═════════════════════════════════════════════════════════════════
// A small overview of the page, since an infinite canvas is easy to get lost on.

const M_minimap = (() => {
  const { $ } = M_util;
  const { store } = M_store;
  const cv = M_canvas;

  let map = null;

  function draw() {
    const c = $('#minimap');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height, pad = 16;
    ctx.clearRect(0, 0, W, H);

    const stage = $('#stage').getBoundingClientRect();
    const b = cv.contentBounds();
    const v = {
      x1: -cv.view.x / cv.view.scale,
      y1: -cv.view.y / cv.view.scale,
    };
    v.x2 = v.x1 + stage.width / cv.view.scale;
    v.y2 = v.y1 + stage.height / cv.view.scale;

    const x1 = Math.min(b.x1, v.x1), y1 = Math.min(b.y1, v.y1);
    const x2 = Math.max(b.x2, v.x2), y2 = Math.max(b.y2, v.y2);
    const s = Math.min((W - pad * 2) / Math.max(x2 - x1, 1), (H - pad * 2) / Math.max(y2 - y1, 1));
    const ox = pad + (W - pad * 2 - (x2 - x1) * s) / 2;
    const oy = pad + (H - pad * 2 - (y2 - y1) * s) / 2;
    map = { x1, y1, s, ox, oy };
    const X = wx => ox + (wx - x1) * s, Y = wy => oy + (wy - y1) * s;

    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--fg-dim').trim() || '#888';
    ctx.strokeStyle = ctx.fillStyle;

    for (const e of store.doc.elements) {
      if (e.type === 'line' || e.type === 'ink') {
        ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.strokeStyle = e.stroke || ctx.fillStyle;
        if (e.type === 'line') {
          const { a, b: bb } = cv.lineEnds(e);
          ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(bb.x), Y(bb.y)); ctx.stroke();
        } else {
          ctx.strokeRect(X(e.x), Y(e.y), Math.max(1, e.w * s), Math.max(1, e.h * s));
        }
        continue;
      }
      const n = cv.nodes.get(e.id);
      const h = e.h || (n ? n.offsetHeight : 40);
      ctx.globalAlpha = e.type === 'text' ? 0.34 : 0.5;
      ctx.fillStyle = e.type === 'box' ? (e.stroke || '#888') : (css.getPropertyValue('--fg-dim').trim() || '#888');
      ctx.fillRect(X(e.x), Y(e.y), Math.max(2, (e.w || 100) * s), Math.max(2, h * s));
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#4a7fd4';
    ctx.lineWidth = 2;
    ctx.strokeRect(X(v.x1), Y(v.y1), (v.x2 - v.x1) * s, (v.y2 - v.y1) * s);
  }

  function mount() {
    const c = $('#minimap');
    c.addEventListener('pointerdown', ev => {
      if (!map) return;
      ev.stopPropagation();
      const r = c.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (c.width / r.width);
      const py = (ev.clientY - r.top) * (c.height / r.height);
      const wx = map.x1 + (px - map.ox) / map.s;
      const wy = map.y1 + (py - map.oy) / map.s;
      const stage = $('#stage').getBoundingClientRect();
      cv.view.x = stage.width / 2 - wx * cv.view.scale;
      cv.view.y = stage.height / 2 - wy * cv.view.scale;
      cv.setZoom(cv.view.scale);
    });
  }

  return { draw, mount };
})();

// ══ export ══════════════════════════════════════════════════════════════════
// Exporting a page: PNG by rasterising the canvas, PDF through the print
// dialog (macOS offers "Save as PDF" there, which beats bundling a PDF writer).

const M_export = (() => {
  const { $, toast } = M_util;
  const { store } = M_store;
  const cv = M_canvas;

  const PAD = 48;

  /** Everything the export needs that lives outside the cloned markup. */
  async function inlineStyles() {
    let css = await (await fetch('css/app.css')).text();

    // Font files are referenced relatively; a data-URL SVG can't resolve those.
    const urls = [...new Set([...css.matchAll(/url\(\.\.\/fonts\/([^)]+)\)/g)].map(m => m[1]))];
    for (const name of urls) {
      const data = await blobToDataUrl(await (await fetch('fonts/' + name)).blob());
      css = css.replaceAll(`url(../fonts/${name})`, `url(${data})`);
    }
    return css;
  }

  const blobToDataUrl = blob => new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

  async function buildSvg(scale) {
    const b = cv.contentBounds();
    const width = Math.max(1, b.x2 - b.x1) + PAD * 2;
    const height = Math.max(1, b.y2 - b.y1) + PAD * 2;

    const clone = $('#world').cloneNode(true);
    clone.style.transform = `translate(${PAD - b.x1}px, ${PAD - b.y1}px)`;
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('.sel').forEach(n => n.classList.remove('sel'));
    for (const img of clone.querySelectorAll('img')) {
      const blob = await fetch(img.src).then(r => r.blob()).catch(() => null);
      if (blob) img.setAttribute('src', await blobToDataUrl(blob));
    }

    const theme = document.documentElement.dataset.theme;
    const paper = getComputedStyle(document.documentElement)
      .getPropertyValue('--canvas').trim() || '#ffffff';
    const css = await inlineStyles();
    const body = new XMLSerializer().serializeToString(clone);

    return { width, height, scale, markup:
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}"
       viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="${paper}"/>
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml" data-theme="${theme}"
           style="width:${width}px;height:${height}px;position:relative;overflow:hidden">
        <style>${css}</style>
        ${body}
      </div>
    </foreignObject>
  </svg>` };
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fileName = ext => (store.doc.meta.title || 'note').replace(/[\/\\:]/g, '-') + '.' + ext;

  async function exportSvg() {
    const { markup } = await buildSvg(1);
    download(new Blob([markup], { type: 'image/svg+xml' }), fileName('svg'));
    toast('Saved ' + fileName('svg'));
  }

  async function exportPng(scale = 2) {
    try {
      const { width, height, markup } = await buildSvg(scale);
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('the page could not be rasterised'));
        i.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('the page could not be rasterised');
      download(blob, fileName('png'));
      toast(`Saved ${fileName('png')} (${canvas.width}×${canvas.height})`);
    } catch (e) {
      toast('PNG export failed: ' + e.message + ' — try Export SVG.', true);
    }
  }

  /** Lay the whole page out at natural size, print, then put it back. */
  function exportPdf() {
    const world = $('#world');
    const stage = $('#stage');
    const before = { transform: world.style.transform, w: stage.style.width, h: stage.style.height };
    const b = cv.contentBounds();

    document.body.classList.add('printing');
    world.style.transform = `translate(${PAD - b.x1}px, ${PAD - b.y1}px)`;
    stage.style.width = (b.x2 - b.x1 + PAD * 2) + 'px';
    stage.style.height = (b.y2 - b.y1 + PAD * 2) + 'px';

    const restore = () => {
      document.body.classList.remove('printing');
      world.style.transform = before.transform;
      stage.style.width = before.w;
      stage.style.height = before.h;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 60000);          // belt and braces if afterprint is missed
  }

  return { exportSvg, exportPng, exportPdf };
})();

// ══ tree ════════════════════════════════════════════════════════════════════
// OneNote-style navigation: root folders and loose notes in the first column,
// and only the direct notes in the selected root folder in the second.

const M_tree = (() => {
  const { $, el, toast, dirOf, baseOf, join } = M_util;
  const { api } = M_api;
  const { showMenu } = M_menu;
  // Every file the sidebar moves, trashes or restores may be the one the store
  // is holding edits for, so all of it goes through the store's lifecycle flow.
  const { moveFile, trashFile, restoreFile } = M_store;

  const EMOJIS = ['❤️', '🔥', '🍕', '🌴'];

  let root = null;
  let palette = [];
  let active = null;
  let selectedFolder = localStorage.getItem('wb:folder') || null;
  let archiveOpen = localStorage.getItem('wb:archive') === 'open';
  let searchArchive = localStorage.getItem('wb:archive-search') === 'on';
  let emojiFilter = null;
  let filterSet = null;
  let snippets = {};
  let terms = [];
  let onOpen = () => {};
  let onStructure = () => {};
  let onScope = () => {};

  const rootFolders = () => root?.folders || [];
  // Archived folders keep their place in the same ordered list the server
  // sends; only which of the two drawers they are painted into differs.
  const liveFolders = () => rootFolders().filter(f => !f.archived);
  const archivedFolders = () => rootFolders().filter(f => f.archived);
  const folderByPath = path => rootFolders().find(f => f.path === path) || null;

  function allNotes() {
    if (!root) return [];
    return [
      ...rootFolders().flatMap(f => f.notes.map(n => ({ ...n, folder: f.path }))),
      ...root.notes.map(n => ({ ...n, folder: '' })),
    ];
  }

  function findByName(name) {
    const key = String(name).toLowerCase().trim();
    return allNotes().find(n => n.name.toLowerCase() === key ||
                                (n.title || '').toLowerCase() === key) || null;
  }

  function rememberFolder(path) {
    selectedFolder = path || null;
    if (selectedFolder) localStorage.setItem('wb:folder', selectedFolder);
    else localStorage.removeItem('wb:folder');
  }

  function setActive(path) {
    active = path;
    if (!path) { paint(); return; }                  // nothing open to point at
    const folder = dirOf(path);
    rememberFolder(folderByPath(folder) ? folder : null);
    paint();
  }

  async function refresh() {
    const data = await api.tree();
    root = data.tree;
    palette = data.palette;
    if (selectedFolder && !folderByPath(selectedFolder)) rememberFolder(null);
    if (!selectedFolder && !active && liveFolders().length) rememberFolder(liveFolders()[0].path);
    paint();
  }

  // ── filtering ───────────────────────────────────────────────────────────

  const noteVisible = n => (!filterSet || filterSet.has(n.path)) &&
                           (!emojiFilter || n.emoji === emojiFilter);
  const folderVisible = f => (!filterSet && !emojiFilter) || f.notes.some(noteVisible);

  function chooseVisibleFolder() {
    if (selectedFolder && folderVisible(folderByPath(selectedFolder) || { notes: [] })) return;
    rememberFolder((liveFolders().find(folderVisible) ||
                    archivedFolders().find(folderVisible))?.path || null);
  }

  function applyFilter(matches, matchTerms = []) {
    if (!matches) { filterSet = null; snippets = {}; terms = []; }
    else {
      filterSet = new Set(matches.map(m => m.path));
      snippets = Object.fromEntries(matches.map(m => [m.path, m.snippet]));
      terms = matchTerms.filter(Boolean);
    }
    chooseVisibleFolder();
    paint();
  }

  function firstVisibleNote() {
    const inFolder = selectedFolder && folderByPath(selectedFolder)?.notes.find(noteVisible);
    return inFolder?.path || root?.notes.find(noteVisible)?.path ||
           [...liveFolders(), ...archivedFolders()]
             .flatMap(f => f.notes).find(noteVisible)?.path || null;
  }

  const escapeHtml = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function markTerms(text) {
    let html = escapeHtml(text);
    for (const term of terms) {
      const needle = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`(?![^<]*>)(${needle})`, 'gi'), '<mark>$1</mark>');
    }
    return html;
  }

  // ── painting ────────────────────────────────────────────────────────────

  function paint() {
    if (!root) return;
    const rootHost = $('#root-list');
    const fileHost = $('#file-list');
    rootHost.innerHTML = '';
    fileHost.innerHTML = '';

    for (const folder of liveFolders()) {
      if (folderVisible(folder)) rootHost.append(folderRow(folder));
    }
    for (const note of root.notes) {
      if (noteVisible(note)) rootHost.append(noteRow(note));
    }
    paintArchive();

    const folder = selectedFolder && folderByPath(selectedFolder);
    if (folder) {
      for (const note of folder.notes) if (noteVisible(note)) fileHost.append(noteRow(note));
      if (!fileHost.children.length) fileHost.append(el('div', { class: 'nav-empty' },
        filterSet || emojiFilter ? 'No matching pages.' : 'No pages in this folder.'));
    } else {
      fileHost.append(el('div', { class: 'nav-empty' }, 'Select a root folder to see its pages.'));
    }

    if (!rootHost.children.length) rootHost.append(el('div', { class: 'nav-empty' }, 'No matching notes.'));
    document.querySelectorAll('.emoji-filter').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.emoji === emojiFilter)));
  }

  /** The Archive drawer: shut by default, and only painted when it is open. */
  function paintArchive() {
    const box = $('#archive');
    const host = $('#archive-list');
    const folders = archivedFolders();
    box.classList.toggle('open', archiveOpen);
    box.classList.toggle('holds-active', folders.some(f => f.path === selectedFolder));
    $('#archive-head').setAttribute('aria-expanded', String(archiveOpen));
    $('#archive-count').textContent = folders.length || '';
    $('#archive-search').checked = searchArchive;
    host.hidden = !archiveOpen;
    if (!archiveOpen) return;
    host.innerHTML = '';
    for (const folder of folders) if (folderVisible(folder)) host.append(folderRow(folder));
    if (!host.children.length) {
      host.append(el('div', { class: 'nav-empty' },
        !folders.length ? 'Drag a folder here to put it away.'
          : filterSet && !searchArchive ? 'Not searched — tick the box to include these.'
          : 'No matching folders.'));
    }
  }

  function folderRow(folder) {
    const row = el('div', {
      class: 'row folder' + (folder.path === selectedFolder ? ' active-folder' : ''),
      draggable: 'true', 'data-path': folder.path, 'data-kind': 'folder',
      onclick: () => { rememberFolder(folder.path); paint(); },
      oncontextmenu: ev => { ev.preventDefault(); folderMenu(ev, folder); },
    },
      el('span', { class: 'chip', style: { background: folder.color } }),
      el('span', { class: 'label', style: { color: folder.color } }, folder.name));
    wireDrag(row, 'folder', folder.path);
    wireFolderDrop(row, folder.path);
    return row;
  }

  function noteRow(note) {
    const snippet = snippets[note.path];
    const row = el('div', {
      class: 'row note' + (note.path === active ? ' active' : '') + (snippet ? ' has-snip' : ''),
      draggable: 'true', 'data-path': note.path, 'data-kind': 'note',
      title: note.path + (note.modified ? `\nedited ${note.modified}` : ''),
      onclick: () => onOpen(note.path),
      oncontextmenu: ev => { ev.preventDefault(); noteMenu(ev, note); },
    },
      el('span', { class: 'note-emoji' }, note.emoji || ''),
      el('span', { class: 'label' }, note.title || note.name),
      snippet ? el('span', { class: 'snip', html: markTerms(snippet) }) : null);
    wireNoteDrag(row, note.path);
    return row;
  }

  // ── drag to move, drag to reorder ───────────────────────────────────────
  //
  // Two kinds travel on the drag: a note, which can be dropped into a folder
  // or between its siblings, and a folder, which can be dropped between its
  // siblings or into the Archive. The kind is the MIME type, so a column only
  // lights up for a drag it can actually accept.

  const DRAG = { note: 'text/wb-path', folder: 'text/wb-folder' };
  const marker = el('div', { class: 'drop-line' });

  const dragKind = ev => (ev.dataTransfer.types.includes(DRAG.note) ? 'note'
    : ev.dataTransfer.types.includes(DRAG.folder) ? 'folder' : null);

  function wireDrag(row, kind, path) {
    row.addEventListener('dragstart', ev => {
      ev.stopPropagation();
      ev.dataTransfer.setData(DRAG[kind], path);
      ev.dataTransfer.effectAllowed = 'move';
    });
  }

  const wireNoteDrag = (row, path) => wireDrag(row, 'note', path);

  function wireFolderDrop(row, folderPath) {
    row.addEventListener('dragover', ev => {
      if (!ev.dataTransfer.types.includes(DRAG.note)) return;
      ev.preventDefault(); row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', async ev => {
      row.classList.remove('drop-target');
      const from = ev.dataTransfer.getData(DRAG.note);
      if (!from) return;                  // a folder: leave it to the column to place
      ev.preventDefault(); ev.stopPropagation();
      marker.remove();
      if (!from.toLowerCase().endsWith('.md')) return;
      await moveNote(from, join(folderPath, baseOf(from)));
    });
  }

  /** Where a row of `kind` dropped at `y` would land in this column. */
  function landing(host, kind, y) {
    const rows = [...host.querySelectorAll(`.row[data-kind="${kind}"]`)];
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (y < box.top + box.height / 2) return { before: row.dataset.path, node: row };
    }
    const last = rows[rows.length - 1];
    return { before: null, node: last ? last.nextSibling : null };
  }

  function wireColumn(host, accepts, parent, archive = false) {
    host.addEventListener('dragover', ev => {
      const kind = dragKind(ev);
      if (!kind || !accepts.includes(kind) || (kind === 'note' && parent() === null)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      // A note held over a folder row goes *into* that folder: the row says so
      // itself, and no insertion line is drawn.
      if (kind === 'note' && ev.target.closest('.row[data-kind="folder"]')) return marker.remove();
      const spot = landing(host, kind, ev.clientY);
      spot.node ? host.insertBefore(marker, spot.node) : host.append(marker);
    });
    host.addEventListener('dragleave', ev => {
      if (!host.contains(ev.relatedTarget)) marker.remove();
    });
    host.addEventListener('drop', async ev => {
      const kind = dragKind(ev);
      if (!kind || !accepts.includes(kind)) return;
      ev.preventDefault();
      marker.remove();
      const path = ev.dataTransfer.getData(DRAG[kind]);
      const before = landing(host, kind, ev.clientY).before;
      if (!path || path === before) return;
      if (kind === 'note') await dropNote(path, parent(), before);
      else await dropFolder(path, archive, before);
    });
  }

  async function dropNote(from, parent, before) {
    if (parent === null || !from.toLowerCase().endsWith('.md')) return;
    let path = from;
    if (dirOf(from) !== parent) {                  // dragged in from another column
      const res = await moveNote(from, join(parent, baseOf(from)));
      if (!res) return;
      path = res.path;
    }
    await reorder(parent, path, before);
  }

  async function dropFolder(path, archive, before) {
    const folder = folderByPath(path);
    if (!folder) return;
    if (Boolean(folder.archived) !== archive) {
      try { await api.setArchived(path, archive); }
      catch (e) { return toast(e.message, true); }
      if (archive) setArchiveOpen(true);           // so it does not just vanish
      await refresh();
    }
    await reorder('', path, before);
  }

  /** Save the whole column's order, with `path` moved in front of `before`. */
  async function reorder(parent, path, before) {
    const scope = parent ? folderByPath(parent) : root;
    if (!scope) return;
    const paths = [...(scope.folders || []).map(f => f.path), ...scope.notes.map(n => n.path)]
      .filter(p => p !== path);
    const at = before ? paths.indexOf(before) : -1;
    at < 0 ? paths.push(path) : paths.splice(at, 0, path);
    try { await api.setOrder(parent, paths); }
    catch (e) { return toast(e.message, true); }
    await refresh();
  }

  async function moveNote(from, to) {
    if (from === to) return;
    const res = await moveFile(from, to).catch(e => toast(e.message, true));
    if (!res) return;
    await refresh(); onStructure();
    if (res.active) onOpen(res.active);
    return res;
  }

  function setArchiveOpen(open) {
    archiveOpen = open;
    localStorage.setItem('wb:archive', open ? 'open' : 'closed');
    paint();
  }

  // ── menus ───────────────────────────────────────────────────────────────

  function folderMenu(ev, folder) {
    showMenu(ev.clientX, ev.clientY, [
      { label: 'New page here', run: () => newNote(folder.path) },
      '-',
      { label: 'Rename…', run: () => rename(folder.path) },
      { colors: palette, pick: async color => { await api.setColor(folder.path, color); refresh(); } },
      '-',
      { label: folder.archived ? 'Take out of archive' : 'Move to archive',
        run: () => dropFolder(folder.path, !folder.archived, null) },
      { label: 'Move to trash', run: () => trash(folder.path, `folder “${folder.name}” and its pages`) },
    ]);
  }

  function noteMenu(ev, note) {
    showMenu(ev.clientX, ev.clientY, [
      { label: 'Open', run: () => onOpen(note.path) },
      { label: 'Rename…', run: () => rename(note.path) },
      '-',
      ...EMOJIS.map(emoji => ({
        label: `${emoji}  ${note.emoji === emoji ? 'Selected' : 'Set emoji'}`,
        run: () => setNoteEmoji(note.path, emoji),
      })),
      note.emoji && { label: 'Remove emoji', run: () => setNoteEmoji(note.path, '') },
      '-',
      { label: 'Copy link', run: () => {
          navigator.clipboard.writeText(`[[${note.name}]]`);
          toast(`Copied [[${note.name}]]`);
        } },
      { label: 'New note beside', run: () => newNote(dirOf(note.path)) },
      { label: 'Version history…', run: () => history(ev, note) },
      '-',
      { label: 'Move to trash', run: () => trash(note.path, `“${note.title || note.name}”`) },
    ].filter(Boolean));
  }

  async function setNoteEmoji(path, emoji) {
    await api.setEmoji(path, emoji);
    await refresh();
    const first = firstVisibleNote();
    if (active === path && emojiFilter && emoji !== emojiFilter && first) onOpen(first);
  }

  // ── actions ─────────────────────────────────────────────────────────────

  async function newNote(folder = selectedFolder || dirOf(active || '')) {
    if (folder && !folderByPath(folder)) folder = '';
    const res = await api.create(join(folder, 'New note.md'), 'note');
    rememberFolder(folder || null);
    await refresh(); onStructure(); onOpen(res.path);
    setTimeout(() => rename(res.path), 60);
    return res.path;
  }

  async function newFolder() {
    const res = await api.create('New folder', 'folder');
    rememberFolder(res.path);
    await refresh(); onStructure(); rename(res.path);
  }

  function rename(path) {
    const row = $(`.row[data-path="${CSS.escape(path)}"]`);
    if (!row) return;
    const label = row.querySelector('.label');
    const before = label.textContent;
    row.draggable = false;                    // let the pointer select the text
    label.contentEditable = 'plaintext-only'; label.spellcheck = true; label.focus();
    const range = document.createRange();
    range.selectNodeContents(label);
    getSelection().removeAllRanges(); getSelection().addRange(range);

    const finish = async keep => {
      label.contentEditable = 'false';
      const name = label.textContent.trim().replace(/[\\/]/g, '-');
      if (!keep || !name || name === before) { paint(); return; }
      const isNote = row.dataset.kind === 'note';
      const to = join(dirOf(path), isNote ? name + '.md' : name);
      try {
        const res = await moveFile(path, to);
        if (!isNote && selectedFolder === path) rememberFolder(res.path);
        await refresh(); onStructure();
        if (res.active) onOpen(res.active);
      } catch (e) { toast(e.message, true); paint(); }
    };
    label.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); label.blur(); }
      if (ev.key === 'Escape') { label.textContent = before; label.blur(); }
    });
    label.addEventListener('blur', () => finish(true), { once: true });
  }

  async function history(ev, note) {
    let versions;
    try { versions = (await api.history(note.path)).versions; }
    catch (e) { return toast(e.message, true); }
    if (!versions.length) return toast('No earlier versions yet — one is kept every 10 minutes of editing.');
    showMenu(ev.clientX, ev.clientY, versions.slice(0, 20).map(version => ({
      label: `${version.date}  ${version.time}`,
      key: (version.bytes / 1024).toFixed(1) + ' KB',
      run: async () => {
        if (!confirm(`Restore “${note.title || note.name}” to ${version.date} ${version.time}?\n\n` +
                     'The current version is kept in history first.')) return;
        try { await restoreFile(note.path, version.at); }
        catch (e) { return toast(e.message, true); }
        await refresh(); onOpen(note.path);
        toast('Restored ' + version.date + ' ' + version.time);
      },
    })));
  }

  async function trash(path, what) {
    if (!confirm(`Move ${what} to notes/.trash?\n\nNothing is erased — you can drag it back out.`)) return;
    let closed;
    try { closed = await trashFile(path); }
    catch (e) { return toast(e.message, true); }
    if (selectedFolder === path) rememberFolder(null);
    await refresh(); onStructure();
    if (closed) {
      // The open note went to .trash; land somewhere else, or on nothing at all.
      const first = firstVisibleNote() || allNotes()[0]?.path;
      first ? onOpen(first) : setActive(null);
    }
    toast('Moved to .trash');
  }

  function mount(opts) {
    onOpen = opts.onOpen;
    onStructure = opts.onStructure || (() => {});
    onScope = opts.onScope || (() => {});
    $('#new-note').onclick = () => newNote();
    $('#new-folder').onclick = () => newFolder();

    document.querySelectorAll('.emoji-filter').forEach(button => {
      button.onclick = () => {
        emojiFilter = emojiFilter === button.dataset.emoji ? null : button.dataset.emoji;
        chooseVisibleFolder(); paint();
        const first = firstVisibleNote();
        if (first && !allNotes().find(n => n.path === active && noteVisible(n))) onOpen(first);
      };
    });

    $('#root-list').addEventListener('contextmenu', ev => {
      if (ev.target.closest('.row')) return;
      ev.preventDefault();
      showMenu(ev.clientX, ev.clientY, [
        { label: 'New loose note', run: () => newNote('') },
        { label: 'New root folder', run: () => newFolder() },
      ]);
    });
    $('#file-list').addEventListener('contextmenu', ev => {
      if (ev.target.closest('.row') || !selectedFolder) return;
      ev.preventDefault();
      showMenu(ev.clientX, ev.clientY, [{ label: 'New page here', run: () => newNote(selectedFolder) }]);
    });

    // A drag abandoned with Escape never reaches a drop, so the line that was
    // following it has to be swept up on its own.
    document.addEventListener('dragend', () => marker.remove());
    wireColumn($('#root-list'), ['note', 'folder'], () => '');
    wireColumn($('#file-list'), ['note'], () => selectedFolder);
    wireColumn($('#archive-list'), ['folder'], () => null, true);
    mountArchive();
  }

  /** The Archive drawer: open/shut, its search checkbox, and dropping into it. */
  function mountArchive() {
    const box = $('#archive');
    const head = $('#archive-head');
    head.onclick = () => setArchiveOpen(!archiveOpen);
    head.onkeydown = ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setArchiveOpen(!archiveOpen); }
    };
    // The checkbox lives inside the header but is not a way to open it.
    $('.archive-scope').addEventListener('click', ev => ev.stopPropagation());
    $('#archive-search').addEventListener('change', ev => {
      searchArchive = ev.target.checked;
      localStorage.setItem('wb:archive-search', searchArchive ? 'on' : 'off');
      onScope();
    });

    head.addEventListener('dragover', ev => {
      if (dragKind(ev) !== 'folder') return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
      box.classList.add('drop-target'); marker.remove();
    });
    head.addEventListener('dragleave', () => box.classList.remove('drop-target'));
    head.addEventListener('drop', ev => {
      if (dragKind(ev) !== 'folder') return;
      ev.preventDefault(); ev.stopPropagation();
      box.classList.remove('drop-target');
      const path = ev.dataTransfer.getData(DRAG.folder);
      if (path) dropFolder(path, true, null);
    });
  }

  return { allNotes, findByName, setActive, refresh, applyFilter, firstVisibleNote, newNote,
    newFolder, rename, mount, searchArchived: () => searchArchive };
})();

// ══ palette ═════════════════════════════════════════════════════════════════
// ⌘K — jump to a note or run a command.

const M_palette = (() => {
  const { $, el } = M_util;
  const { allNotes } = M_tree;

  let commands = [], onPick = () => {}, items = [], cursor = 0;

  function mount(opts) {
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

  function open() {
    const box = $('#palette');
    box.hidden = false;
    const input = $('#palette-input');
    input.value = '';
    refill('');
    input.focus();
  }

  function close() { $('#palette').hidden = true; }
  const isOpen = () => !$('#palette').hidden;

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

  return { mount, open, close, isOpen };
})();

// ══ history ═════════════════════════════════════════════════════════════════
// The History page: the note's named steps, newest first, each one a place the
// document can be put back to. Deliberately not a keystroke log — typing is
// left to ⌘Z, and this is for the things that are hard to take back by hand.

const M_history = (() => {
  const { $, el, toast } = M_util;
  const { store, on, revertTo, keyOfSnap, currentKey } = M_store;

  let sheet, list;
  let afterRevert = () => {};

  const isOpen = () => sheet && !sheet.hidden;

  /** "just now", "4 min ago", "14:02", "02SEP 14:02" — as coarse as it can be
   *  while still telling two steps apart. */
  function when(at) {
    const d = new Date(at);
    const secs = (Date.now() - at) / 1000;
    if (secs < 45) return 'just now';
    if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
    const clock = d.toTimeString().slice(0, 5);
    return d.toDateString() === new Date().toDateString()
      ? clock : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en', { month: 'short' })} ${clock}`;
  }

  /** A leading glyph, so the shape of what happened reads at a glance. */
  function glyph(label) {
    const l = label.toLowerCase();
    if (l.startsWith('pasted')) return '⇥';
    if (l.startsWith('cut') || l.startsWith('deleted') || l.startsWith('removed')) return '−';
    if (l.startsWith('added') || l.startsWith('inserted') || l.startsWith('duplicated')) return '＋';
    if (l.includes('colour')) return '◆';
    if (l.startsWith('column width') || l.startsWith('row height')) return '↔';
    if (l.startsWith('sorted')) return '⇅';
    if (l.startsWith('moved') || l.startsWith('nudged') || l.startsWith('resized')) return '⤢';
    if (l.includes('row numbers')) return '№';
    if (l.startsWith('went back')) return '↺';
    if (l.startsWith('opened')) return '○';
    return '·';
  }

  function paint() {
    if (!isOpen()) return;
    const steps = store.actions;
    $('#history-sub').textContent = steps.length
      ? `${store.doc.meta.title || 'this page'} — ${steps.length} step${steps.length === 1 ? '' : 's'}`
      : store.doc.meta.title || 'this page';

    list.innerHTML = '';
    if (!steps.length) {
      list.append(el('li', { class: 'history-empty' },
        'Nothing here yet. Pasting, deleting, recolouring and table edits all show up on this page.'));
      return;
    }

    const now = currentKey();           // reads the live editors as a side effect
    for (const step of [...steps].reverse()) {
      const here = keyOfSnap(step.snap) === now;
      list.append(el('li', {
        class: 'history-step' + (here ? ' here' : ''),
        onclick: () => go(step),
      },
        el('span', { class: 'history-mark' }, glyph(step.label)),
        el('span', { class: 'history-label' }, step.label),
        el('span', { class: 'history-when' }, when(step.at)),
        el('span', { class: 'history-go' }, here ? 'you are here' : 'Go back to here')));
    }
  }

  function go(step) {
    if (keyOfSnap(step.snap) === currentKey()) { toast('The page already looks like that.'); return; }
    if (!revertTo(step.id)) { toast('That step could not be restored.', true); return; }
    afterRevert();
    toast('Went back to “' + step.label + '”');
    paint();
  }

  function open() {
    sheet.hidden = false;
    paint();
    $('#history-close').focus();
  }

  const close = () => { sheet.hidden = true; };
  const toggle = () => (isOpen() ? close() : open());

  function mount(opts = {}) {
    sheet = $('#history');
    list = $('#history-list');
    afterRevert = opts.onRevert || (() => {});

    $('#btn-history').onclick = toggle;
    $('#history-close').onclick = close;
    sheet.addEventListener('pointerdown', ev => { if (ev.target === sheet) close(); });

    on('actions', paint);
    on('load', paint);
  }

  return { mount, open, close, toggle, isOpen };
})();

// ══ toolbar ═════════════════════════════════════════════════════════════════
// The toolbar: tools, fonts, text formatting, colours, tables, shape styling,
// undo/redo and zoom.

const M_toolbar = (() => {
  const { $, $$, el, toast, debounce } = M_util;
  const rt = M_richtext;
  const cv = M_canvas;
  const exporter = M_export;
  const tbl = M_table;
  const { showMenu } = M_menu;
  const { store, commit, act, beginAction, undo, redo, canUndo, canRedo } = M_store;

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
    host.innerHTML = tbl.newTable(rows, cols) + '<p><br></p>';
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
    commit(`Inserted a ${rows} × ${cols} table`);
  }

  // ── the table row, which appears whenever a table is in play ─────────────

  /** What the shared line-colour swatch should paint: a selected shape takes it,
   *  and otherwise a table in play does. Null means "the default shape style". */
  function lineTarget() {
    if (cv.selected().some(e => ['box', 'line', 'ink'].includes(e.type))) return null;
    return tableTarget();
  }

  /**
   * The table the tools should act on. `precise` marks the case that matters:
   * the caret is genuinely in a cell, so "delete this row" knows which row is
   * meant. A section containing a table is not itself a table selection.
   */
  function tableTarget() {
    const cell = rt.caretCell();
    if (cell) return { cell, table: tbl.tableOf(cell), precise: true };
    return null;
  }

  /** Which way the last sort on a given table ran, so the button can flip it. */
  const sortState = new WeakMap();

  function sortHere(table, cell) {
    const col = tbl.columnIndex(table, cell);
    const last = sortState.get(table);
    const dir = last && last.col === col && last.dir === 'asc' ? 'desc' : 'asc';
    if (!tbl.sortColumn(table, cell, dir)) {
      toast('Sorting needs a plain grid — this table has merged cells.', true);
      return null;
    }
    sortState.set(table, { col, dir });
    return dir;
  }

  // Each entry is what to do and what to call it afterwards. `label` may be a
  // function so a toggle can name the direction it just went in. `cell: true`
  // marks the ones that need to know *which* cell, not just which table.
  const TABLE_ACTIONS = {
    rowAbove:   { cell: true, run: (t, c) => tbl.insertRow(t, c, false), label: 'Added a table row above' },
    rowBelow:   { cell: true, run: (t, c) => tbl.insertRow(t, c, true),  label: 'Added a table row below' },
    colLeft:    { cell: true, run: (t, c) => tbl.insertColumn(t, c, false), label: 'Added a table column left' },
    colRight:   { cell: true, run: (t, c) => tbl.insertColumn(t, c, true),  label: 'Added a table column right' },
    delRow:     { cell: true, run: (t, c) => tbl.deleteRow(t, c),    label: 'Deleted a table row' },
    delCol:     { cell: true, run: (t, c) => tbl.deleteColumn(t, c), label: 'Deleted a table column' },
    delTable:   { run: t => t.remove(),                  label: 'Deleted a table' },
    mergeRight: { cell: true, run: (t, c) => { if (!tbl.mergeRight(t, c)) toast('No matching cell to the right.'); },
                  label: 'Merged table cells' },
    mergeDown:  { cell: true, run: (t, c) => { if (!tbl.mergeDown(t, c)) toast('No matching cell below.'); },
                  label: 'Merged table cells' },
    split:      { cell: true, run: (t, c) => { if (!tbl.splitCell(t, c)) toast('That cell is not merged.'); },
                  label: 'Split a table cell' },
    header:     { run: t => tbl.toggleHeaderRow(t),
                  label: t => tbl.hasHeaderRow(t) ? 'Made a header row' : 'Removed the header row' },
    rules:      { run: t => tbl.toggleBorders(t),
                  label: t => tbl.bordersOn(t) ? 'Showed the table rules' : 'Hid the table rules' },
    numbers:    { run: t => tbl.toggleRowNumbers(t),
                  label: t => tbl.hasRowNumbers(t) ? 'Turned row numbers on' : 'Turned row numbers off' },
    sort:       { cell: true, run: (t, c) => sortHere(t, c),
                  label: (t, c, dir) => dir ? `Sorted the table ${dir === 'asc' ? 'A → Z' : 'Z → A'}` : '' },
  };

  /**
   * The bar floats over the page by living inside the stage — which also puts it
   * inside the canvas's pointer handling. Left alone, pressing a button reaches
   * the canvas first, and the canvas reads a press on empty space as "leave the
   * text": it blurs the editor and forgets the parked selection, so by the time
   * the button's own handler runs there is no cell left to act on and the bar
   * hides itself. Seal the bar off, the way the minimap does.
   */
  function sealTableBar() {
    const bar = $('#table-bar');
    for (const type of ['pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'wheel'])
      bar.addEventListener(type, ev => ev.stopPropagation());
  }

  const PICK_A_CELL = 'Click inside a cell first — this acts on the cell you are in.';

  /**
   * Put the caret back where the tools just worked. Sorting re-appends whole
   * rows and a delete can shuffle cells between them; either way the browser
   * drops the caret somewhere outside the table, and every press after that
   * would have no cell to work from. When the cell itself is gone — a deleted
   * row or column — the caret lands on whatever took its place, the way a word
   * processor leaves you where you were rather than back at the header.
   */
  function keepCaret({ cell, table }, was) {
    if (cell.isConnected) {
      if (rt.caretCell() !== cell) rt.focusCell(cell);
      return;
    }
    if (!table.isConnected) return;                   // the table itself is gone
    const next = was ? tbl.cellNear(table, was.r, was.c) : table.querySelector('td, th');
    if (next) rt.focusCell(next);
  }

  function mountTableBar() {
    sealTableBar();
    for (const btn of $$('#table-bar [data-table]')) {
      btn.onmousedown = ev => ev.preventDefault();     // keep the caret in the cell
      btn.dataset.tip = btn.title;                     // restored when it re-enables
      btn.onclick = () => {
        const target = tableTarget();
        const action = TABLE_ACTIONS[btn.dataset.table];
        if (!target || (action.cell && !target.precise)) return;
        const was = tbl.positionOf(target.table, target.cell);
        beginAction();
        const out = action.run(target.table, target.cell);
        tbl.refit(target.table);
        const label = typeof action.label === 'function'
          ? action.label(target.table, target.cell, out) : action.label;
        commit(label ? { label } : {});
        keepCaret(target, was);
        syncState();
      };
    }
    mountSizeFields();
  }

  // ── the width / height fields ─────────────────────────────────────────────

  /** Read a pixel count out of a field, tolerating "120", "120px" and " 120 ". */
  const readPx = input => {
    const n = parseInt(String(input.value).replace(/[^0-9.-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  function mountSizeFields() {
    const wire = (id, label, apply) => {
      const input = $('#' + id);
      input.addEventListener('keydown', ev => {
        ev.stopPropagation();                         // the app's shortcuts stay out of here
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); syncTableBar(); input.blur(); }
      });
      input.addEventListener('change', () => {
        const target = tableTarget();
        const px = readPx(input);
        if (!target?.precise || px == null) { syncTableBar(); return; }
        act(`${label} → ${Math.max(1, Math.round(px))} px`, () => apply(target, px));
        syncTableBar();
        syncState();
      });
    };
    wire('table-col-w', 'Column width', (t, px) => tbl.setColumnWidth(t.table, t.cell, px));
    wire('table-row-h', 'Row height',   (t, px) => tbl.setRowHeight(t.cell, px));
  }

  function syncTableBar() {
    const target = tableTarget();
    const bar = $('#table-bar');
    bar.hidden = !target;
    // The backlinks chip sits under the table tools, so it has to know how
    // tall they came out — the row of buttons is not a fixed height.
    $('#stage').style.setProperty('--table-bar-h', target ? bar.offsetHeight + 'px' : '0px');
    if (!target) return;
    $('#table-header').classList.toggle('on', tbl.hasHeaderRow(target.table));
    $('#table-rules').classList.toggle('on', tbl.bordersOn(target.table));
    $('#table-numbers').classList.toggle('on', tbl.hasRowNumbers(target.table));

    // Without a caret in a cell there is no "this row" to add above or delete.
    for (const btn of $$('#table-bar [data-table]')) {
      if (!TABLE_ACTIONS[btn.dataset.table].cell) continue;
      btn.disabled = !target.precise;
      btn.title = target.precise ? btn.dataset.tip : PICK_A_CELL;
    }
    if (target.precise) $('#table-split').disabled = !tbl.isMerged(target.cell);

    const w = $('#table-col-w'), h = $('#table-row-h');
    w.disabled = h.disabled = !target.precise;
    // Don't yank the value out from under someone mid-edit.
    if (document.activeElement !== w)
      w.value = target.precise ? tbl.columnWidth(target.table, target.cell) ?? '' : '';
    if (document.activeElement !== h)
      h.value = target.precise ? tbl.rowHeight(target.cell) ?? '' : '';
  }

  // ── dragging a row or column border ───────────────────────────────────────
  //
  // The grip is the last few pixels inside a cell's right or bottom edge. It has
  // to be caught in the capture phase: the canvas owns pointerdown on the stage,
  // and the cell itself is contenteditable, so both would otherwise get there
  // first and turn the drag into a text selection.

  const GRIP = 5;

  /** Which border, if any, the cursor is sitting on. `node` skips the hit test
   *  where the event already names what is under the cursor — plain hovering
   *  should not flush layout on every move across the canvas. */
  function gripAt(clientX, clientY, node) {
    const cell = tbl.cellOf(node || document.elementFromPoint(clientX, clientY));
    if (!cell) return null;
    const table = tbl.tableOf(cell);
    if (!table || !cell.closest('.rt')) return null;
    const r = cell.getBoundingClientRect();
    const slack = GRIP * cv.view.scale;
    if (Math.abs(clientX - r.right) <= slack) return { kind: 'col', cell, table };
    if (Math.abs(clientY - r.bottom) <= slack) return { kind: 'row', cell, table };
    return null;
  }

  function mountTableResize() {
    const stage = $('#stage');

    stage.addEventListener('pointermove', ev => {
      if (ev.buttons || resizing) return;
      showGrip(gripAt(ev.clientX, ev.clientY, ev.target)?.kind || null);
    });
    stage.addEventListener('pointerleave', () => { if (!resizing) showGrip(null); });

    stage.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const grip = gripAt(ev.clientX, ev.clientY);
      if (!grip) return;
      ev.preventDefault();
      ev.stopPropagation();
      startResize(ev, grip);
    }, true);
  }

  let resizing = false;

  /** Flag the stage so the whole cell, editor included, shows the drag cursor. */
  function showGrip(kind) {
    const stage = $('#stage');
    stage.classList.toggle('grip-col', kind === 'col');
    stage.classList.toggle('grip-row', kind === 'row');
  }

  function startResize(ev, { kind, cell, table }) {
    const scale = cv.view.scale || 1;
    resizing = true;
    showGrip(kind);
    const from = kind === 'col' ? ev.clientX : ev.clientY;
    const start = kind === 'col' ? (tbl.columnWidth(table, cell) || cell.offsetWidth)
                                 : (tbl.rowHeight(cell) || cell.offsetHeight);
    let size = start;
    beginAction();

    const move = m => {
      const delta = ((kind === 'col' ? m.clientX : m.clientY) - from) / scale;
      size = Math.max(kind === 'col' ? tbl.MIN_COL : tbl.MIN_ROW, Math.round(start + delta));
      if (kind === 'col') tbl.setColumnWidth(table, cell, size);
      else tbl.setRowHeight(cell, size);
      syncTableBar();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      resizing = false;
      showGrip(null);
      if (size !== start) {
        commit(`${kind === 'col' ? 'Column width' : 'Row height'} → ${size} px`);
      }
      syncState();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── shape kind ────────────────────────────────────────────────────────────

  function shapeMenu(ev) {
    showMenu(ev.clientX, ev.clientY, Object.entries(cv.SHAPES).map(([kind, def]) => ({
      label: def.label + (cv.style.shape === kind ? '  ✓' : ''),
      run: () => { cv.style.shape = kind; cv.setTool('box'); syncState(); },
    })));
  }

  // ── the bar never wraps ───────────────────────────────────────────────────
  // A long note title eats the room the tools need, so as the bar runs out of
  // width whole groups fold away into the ⋯ popover, in this order. The drawing
  // tools are not in the list: they stay put, and if even they cannot fit the
  // bar scrolls sideways rather than growing a second row.

  const FOLD_ORDER = [
    ['#g-insert'],                  // lists, indent, link, table
    ['.tail'],                      // undo / redo and zoom
    ['#g-font'],                    // font and size
    ['#g-format', '#g-colors'],     // bold / italic / underline and the colours
    ['#shape-tools'],               // stroke, fill, thickness, arrow ends
  ];

  let stages = [];

  /** Remember where each group sits so it can go back to exactly that spot. */
  function measureFolding() {
    stages = FOLD_ORDER.map(group => group.map(sel => $(sel)).filter(Boolean).map(node => {
      const slot = el('i', { class: 'tslot', hidden: 'hidden' });
      node.before(slot);
      const prev = slot.previousElementSibling;
      return { node, slot, sep: prev?.classList.contains('sep') ? prev : null };
    }));
  }

  const overflows = bar => bar.scrollWidth > bar.clientWidth + 1;

  function reflow() {
    const bar = $('#toolbar'), pop = $('#tools-pop'), more = $('#tools-more');
    if (!bar || !stages.length) return;
    pop.hidden = true;

    for (const stage of stages)                 // start from the whole bar…
      for (const { node, slot, sep } of stage) {
        slot.after(node);
        if (sep) sep.hidden = false;
      }
    more.hidden = true;

    const folded = [];
    for (const stage of stages) {               // …then fold until it fits
      if (!overflows(bar)) break;
      for (const part of stage) {
        part.node.remove();
        if (part.sep) part.sep.hidden = true;
        folded.push(part);
      }
      more.hidden = false;                      // the button takes room as well
    }

    // The popover lists what it holds in the order the bar itself would.
    const order = [...bar.querySelectorAll('.tslot')];
    folded.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    pop.append(...folded.map(part => part.node));
  }

  function togglePop() {
    const pop = $('#tools-pop'), btn = $('#tools-more');
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) {
      if (!pop.contains(e.target) && e.target !== btn) {
        pop.hidden = true;
        document.removeEventListener('pointerdown', off, true);
      }
    }, true), 0);
  }

  // ── state sync ────────────────────────────────────────────────────────────

  function syncState() {
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
    const table = lineTarget();
    $('#stroke-width').value = String(shapeOn ? (shapes[0].strokeWidth ?? 2) : cv.style.strokeWidth);
    $('#stroke-width').disabled = !!table;
    $('#stroke-color').title = table ? 'Table line colour' : 'Line / border colour';
    setBar($('#stroke-color'), table ? (tbl.lineColor(table.table) || 'var(--line)')
                                     : shapeOn ? shapes[0].stroke : cv.style.stroke);
    const fill = shapeOn ? shapes.find(s => s.type === 'box')?.fill : cv.style.fill;
    setBar($('#fill-color'), fill && fill !== 'none' ? fill : null);
    const lines = shapes.filter(s => s.type === 'line');
    $('#arrow-start').classList.toggle('on', lines.length ? lines[0].arrowStart : cv.style.arrowStart);
    $('#arrow-end').classList.toggle('on', lines.length ? lines[0].arrowEnd : cv.style.arrowEnd);

    const textish = sel.filter(e => e.type === 'text' || e.type === 'box');
    $('#font-select').value = textish[0]?.font || store.doc.meta.font || 'Roboto';
    $('#size-select').value = String(textish[0]?.size || 16);

    syncTableBar();

    $('#btn-undo').disabled = !canUndo();
    $('#btn-redo').disabled = !canRedo();
    $('#zoom-reset').textContent = Math.round(cv.view.scale * 100) + '%';
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  function mount() {
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

    $('#stroke-color').onmousedown = ev => ev.preventDefault();   // keep the caret in the cell
    $('#stroke-color').onclick = () => {
      const table = lineTarget();
      const current = table ? tbl.lineColor(table.table) : cv.style.stroke;
      openColorPop($('#stroke-color'), current, c => {
        if (table) {
          act(c ? 'Table line colour → ' + c : 'Reset the table line colour',
              () => tbl.setLineColor(table.table, c));
        } else {
          cv.style.stroke = c;
          if (!cv.applyToSelection({ stroke: c }, 'Line colour → ' + c)) setBar($('#stroke-color'), c);
        }
        syncState();
      }, { none: !!table });
    };

    $('#fill-color').onclick = () => openColorPop($('#fill-color'), cv.style.fill, c => {
      cv.style.fill = c || 'none';
      const label = c ? 'Fill colour → ' + c : 'Cleared the fill';
      if (!cv.applyToSelection({ fill: c || 'none' }, label)) setBar($('#fill-color'), c);
      syncState();
    }, { none: true });

    $('#stroke-width').onchange = e => {
      const w = +e.target.value;
      cv.style.strokeWidth = w;
      cv.applyToSelection({ strokeWidth: w }, `Line thickness → ${w} px`);
      syncState();
    };

    for (const end of ['start', 'end']) {
      $('#arrow-' + end).onclick = () => {
        const key = end === 'start' ? 'arrowStart' : 'arrowEnd';
        const lines = cv.selected().filter(e => e.type === 'line');
        const next = lines.length ? !lines[0][key] : !cv.style[key];
        cv.style[key] = next;
        for (const l of lines) l[key] = next;
        if (lines.length) { cv.render(); commit(`${next ? 'Added' : 'Removed'} an arrow head`); }
        syncState();
      };
    }

    $('#font-select').onmousedown = () => rt.saveRange();
    $('#font-select').onchange = e => {
      const font = e.target.value;
      if (rt.hasSelection()) rt.styleRange({ fontFamily: cv.fontStack(font) }, 'Font → ' + font);
      else if (!cv.applyToSelection({ font }, 'Font → ' + font)) {
        store.doc.meta.font = font;
        cv.render(); commit('Page font → ' + font);
      }
      syncState();
    };

    $('#size-select').onmousedown = () => rt.saveRange();
    $('#size-select').onchange = e => {
      const size = +e.target.value;
      if (rt.hasSelection()) rt.applyFontSize(size);          // just the selected words
      else if (!cv.applyToSelection({ size }, `Text size → ${size} px`))
        toast('Select some text, a box or a shape first.');
      syncState();
    };

    $('#btn-clear-fmt').onmousedown = ev => ev.preventDefault();
    $('#btn-clear-fmt').onclick = () => { rt.clearFormatting(); syncState(); };

    $('#box-kind').onclick = shapeMenu;
    $('.tool[data-tool="box"]').oncontextmenu = ev => { ev.preventDefault(); shapeMenu(ev); };

    $('#tools-more').onclick = togglePop;

    measureFolding();
    addEventListener('resize', debounce(reflow, 120));
    requestAnimationFrame(reflow);

    $('#btn-undo').onclick = () => { undo(); syncState(); };
    $('#btn-redo').onclick = () => { redo(); syncState(); };
    $('#zoom-in').onclick = () => cv.zoomBy(1.2);
    $('#zoom-out').onclick = () => cv.zoomBy(1 / 1.2);
    $('#zoom-reset').onclick = () => cv.setZoom(1);
    $('#zoom-fit').onclick = () => cv.fitToContent();

    mountTablePicker();
    mountTableBar();
    mountTableResize();
    syncState();
  }

  return { syncState, mount, reflow };
})();

// ══ main ════════════════════════════════════════════════════════════════════
// Wiring: theme, note lifecycle, header, search, shortcuts, image handling.

const M_main = () => {
  const { $, $$, el, debounce, toast, stemOf, dirOf } = M_util;
  const { api } = M_api;
  const { store, on, open: openNote, saveNow, undo, redo, commit, startWatching,
          moveFile } = M_store;
  const tree = M_tree;
  const cv = M_canvas;
  const toolbar = M_toolbar;
  const rt = M_richtext;
  const palette = M_palette;
  const history = M_history;
  const minimap = M_minimap;
  const exporter = M_export;
  const { showMenu } = M_menu;

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

  // ── left pane ─────────────────────────────────────────────────────────────
  // The toggle sits at the head of the toolbar, so it stays put — and stays
  // reachable — whether the pane is showing or not.

  const setPane = hidden => {
    document.body.classList.toggle('pane-hidden', hidden);
    localStorage.setItem('wb:pane', hidden ? 'hidden' : 'shown');
    $('#pane-toggle').title = (hidden ? 'Show' : 'Hide') + ' the sidebar  (⌘/)';
    $('#pane-toggle').setAttribute('aria-label', $('#pane-toggle').title);
    toolbar.reflow();          // the bar just gained or lost the sidebar's width
    minimap.draw();
  };
  const togglePane = () => setPane(!document.body.classList.contains('pane-hidden'));

  setPane(localStorage.getItem('wb:pane') === 'hidden');
  $('#pane-toggle').onclick = togglePane;

  // ── header ────────────────────────────────────────────────────────────────

  let backlinks = {};

  // A name is never shown longer than this; the full one comes back on focus.
  const TITLE_MAX = 25;

  function paintTitle(name) {
    const title = $('#note-title');
    title.dataset.full = name;
    title.textContent = name.length > TITLE_MAX ? name.slice(0, TITLE_MAX).trimEnd() + '…' : name;
  }

  function paintHeader() {
    const m = store.doc.meta;
    const title = $('#note-title');
    if (title !== document.activeElement && title.dataset.full !== m.title) paintTitle(m.title);
    $('#meta-created').textContent = 'created ' + m.created;
    $('#meta-modified').textContent = 'edited ' + m.modified;
    document.title = (m.title || 'Paper') + ' — Paper';

    const back = backlinks[store.path] || [];
    const host = $('#backlinks');
    host.innerHTML = '';
    $('#meta-row').hidden = !back.length;
    if (back.length) {
      host.append('linked from ');
      back.forEach((p, i) => {
        if (i) host.append(', ');
        host.append(el('a', { href: '#', onclick: ev => { ev.preventDefault(); go(p); } }, stemOf(p)));
      });
    }
  }

  $('#note-title').addEventListener('focus', () => {
    const title = $('#note-title');
    const full = title.dataset.full || '';
    if (title.textContent === full) return;
    title.textContent = full;                  // editing always sees the whole name
    const range = document.createRange();
    range.selectNodeContents(title); range.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  $('#note-title').addEventListener('input', () => {
    const title = $('#note-title');
    store.doc.meta.title = title.textContent.trim() || 'Untitled';
    title.dataset.full = title.textContent;
    commit({ coalesce: true });
  });
  $('#note-title').addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); $('#note-title').blur(); }
  });
  $('#note-title').addEventListener('blur', async () => {
    if (M_store.editingBlocked()) return;
    commit();
    const from = store.path;
    const wanted = ($('#note-title').textContent.trim() || 'Untitled')
      .replace(/[\\/]/g, '-').replace(/\.md$/i, '') || 'Untitled';
    paintTitle(store.doc.meta.title);
    toolbar.reflow();
    if (!from || stemOf(from) === wanted) { refreshLinks(); return; }
    try {
      const folder = dirOf(from);
      const res = await moveFile(from, (folder ? folder + '/' : '') + wanted + '.md');
      await tree.refresh();
      if (!res.active) { refreshLinks(); return; }   // switched notes mid-rename
      await go(res.active);
      const actual = stemOf(res.path);
      if (actual !== wanted) {
        store.doc.meta.title = actual;
        commit(); await saveNow(); await tree.refresh();
        toast(`That name already existed, so this note is now “${actual}”.`);
      }
      refreshLinks();
    } catch (e) { toast(e.message, true); }
  });

  const refreshLinks = debounce(async () => {
    try { backlinks = (await api.links()).backlinks; paintHeader(); } catch { /* ignore */ }
  }, 400);

  // ── opening notes ─────────────────────────────────────────────────────────

  async function go(path) {
    try {
      if (!await openNote(path)) return false;
      tree.setActive(store.path);
      refreshLinks();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }

  rt.setElementItems(id => {
    const one = store.doc.elements.filter(e => e.id === id);
    if (!one.length) return [];
    return ['-',
      { label: 'Bring to front', run: () => cv.stackTo(one, true) },
      { label: 'Send to back',   run: () => cv.stackTo(one, false) }];
  });

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
  let matchRanges = [];
  let activeMatch = -1;
  let searchFrame = 0;
  const searchRail = document.createElement('div');
  searchRail.id = 'search-rail';
  searchRail.hidden = true;
  searchRail.setAttribute('aria-label', 'Search matches and file position');
  $('#stage').append(searchRail);

  function searchExtent() {
    const b = cv.contentBounds();
    const height = $('#stage').clientHeight / cv.view.scale;
    return { top: Math.min(0, b.y1), bottom: Math.max(b.y2, height), height };
  }

  function drawSearchRail() {
    searchFrame = 0;
    searchRail.hidden = !searchTerms.length;
    if (searchRail.hidden) return;
    const { top, bottom, height } = searchExtent();
    const span = Math.max(1, bottom - top);
    const position = y => Math.max(0, Math.min(100, (y - top) / span * 100));
    const viewportTop = -cv.view.y / cv.view.scale;
    const thumb = document.createElement('div');
    thumb.className = 'search-position';
    thumb.style.top = position(viewportTop) + '%';
    thumb.style.height = Math.max(0, position(viewportTop + height) - position(viewportTop)) + '%';
    const fragment = document.createDocumentFragment();
    fragment.append(thumb);
    const stageRect = $('#stage').getBoundingClientRect();
    matchRanges.forEach((range, index) => {
      if (!range.startContainer.isConnected) return;
      const rect = range.getBoundingClientRect();
      const y = (rect.top - stageRect.top - cv.view.y) / cv.view.scale;
      const marker = document.createElement('button');
      marker.className = 'search-marker' + (index === activeMatch ? ' active' : '');
      marker.style.top = position(y) + '%';
      marker.dataset.match = index;
      marker.title = `Match ${index + 1} of ${matchRanges.length}`;
      marker.setAttribute('aria-label', marker.title);
      fragment.append(marker);
    });
    searchRail.replaceChildren(fragment);
  }

  function scheduleSearchRail() {
    if (!searchFrame) searchFrame = requestAnimationFrame(drawSearchRail);
  }

  function jumpToMatch(index) {
    if (!matchRanges.length) return;
    activeMatch = (index + matchRanges.length) % matchRanges.length;
    const rect = matchRanges[activeMatch].getBoundingClientRect();
    const stageRect = $('#stage').getBoundingClientRect();
    cv.view.y += stageRect.top + stageRect.height / 2 - (rect.top + rect.height / 2);
    if (rect.left < stageRect.left + 20 || rect.right > stageRect.right - 24)
      cv.view.x += stageRect.left + stageRect.width / 2 - (rect.left + rect.width / 2);
    cv.setZoom(cv.view.scale);
  }

  searchRail.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const marker = ev.target.closest('[data-match]');
    if (marker) { jumpToMatch(+marker.dataset.match); return; }
    const rect = searchRail.getBoundingClientRect();
    const { top, bottom, height } = searchExtent();
    const y = top + (ev.clientY - rect.top) / rect.height * (bottom - top);
    cv.view.y = -(y - height / 2) * cv.view.scale;
    cv.setZoom(cv.view.scale);
  });
  searchRail.addEventListener('click', ev => {
    // Keyboard activation of a marker does not send pointerdown.
    if (ev.detail === 0 && ev.target.dataset.match != null) jumpToMatch(+ev.target.dataset.match);
  });
  searchRail.addEventListener('dblclick', ev => ev.stopPropagation());
  new ResizeObserver(scheduleSearchRail).observe($('#stage'));
  new ResizeObserver(() => { if (searchTerms.length) repaintMatches(); }).observe($('#world'));

  function paintMatches() {
    if (!window.CSS?.highlights) return;
    CSS.highlights.delete('wb-search');
    matchRanges = [];
    activeMatch = -1;
    scheduleSearchRail();
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
    matchRanges = ranges.filter(r => r.startContainer.parentElement.closest('.rt'));
  }

  const repaintMatches = debounce(paintMatches, 90);
  document.addEventListener('input', () => { if (searchTerms.length) repaintMatches(); }, true);

  // ── search ────────────────────────────────────────────────────────────────

  let searchVersion = 0;
  const runSearch = debounce(async (q, version) => {
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
      const { matches, terms } = await api.search(q, tree.searchArchived());
      if (version !== searchVersion) return;
      tree.applyFilter(matches, terms);
      searchTerms = terms.filter(Boolean);
      const first = tree.firstVisibleNote();
      if (first && first !== store.path) await go(first);
      paintMatches();
      jumpToMatch(0);
      status.hidden = false;
      status.classList.remove('bad');
      const hits = CSS.highlights?.get('wb-search')?.size ?? 0;
      status.textContent = `${matches.length} note${matches.length === 1 ? '' : 's'} match` +
                           (hits ? ` · ${hits} here` : '');
    } catch (e) {
      status.hidden = false; status.classList.add('bad'); status.textContent = e.message;
    }
  }, 180);

  $('#search').addEventListener('input', e => runSearch(e.target.value, ++searchVersion));
  $('#search').addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.target.value = ''; runSearch('', ++searchVersion); ev.target.blur(); }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      jumpToMatch(activeMatch + (ev.shiftKey ? -1 : 1));
    }
  });
  $('#search-clear').onclick = () => { $('#search').value = ''; runSearch('', ++searchVersion); };

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

    if (ev.key === 'Escape' && history.isOpen()) { ev.preventDefault(); history.close(); return; }
    if (mod && ev.shiftKey && key === 'h') { ev.preventDefault(); history.toggle(); return; }
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
    if (mod && key === '/') { ev.preventDefault(); togglePane(); return; }
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

    if (typing || history.isOpen()) return;

    if (ev.key === 'Escape') { cv.clearSelection(); palette.close(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); cv.removeSelected(); return; }
    if (!mod && TOOL_KEYS[key]) { cv.setTool(TOOL_KEYS[key]); return; }
    if (ev.key.startsWith('Arrow')) {
      const step = ev.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (d && cv.selected().length) {
        ev.preventDefault();
        const moving = cv.selected();
        for (const e of moving) { e.x += d[0]; e.y += d[1]; }
        cv.render(); commit(`Nudged ${moving.length === 1 ? 'an object' : moving.length + ' objects'}`);
      }
    }
  });

  // ── canvas context menu ───────────────────────────────────────────────────

  stage.addEventListener('contextmenu', ev => {
    if (ev.target.closest('.rt')) return;                 // richtext has its own
    ev.preventDefault();
    const node = ev.target.closest('.el') || ev.target.closest('path.hit');
    const id = node?.dataset?.id;
    if (id && !cv.selection.has(id)) cv.select(id);
    const some = cv.selected().length;
    const image = id && store.doc.elements.find(element => element.id === id && element.type === 'image');
    const at = cv.toWorld(ev.clientX, ev.clientY);
    showMenu(ev.clientX, ev.clientY, [
      image && { label: image.showPath === false ? 'Show file path' : 'Hide file path',
                 run: () => cv.setImagePathVisible(image.id, image.showPath === false) },
      image && { label: 'Copy file path', run: () => cv.copyImagePath(image.id).catch(e => toast(e.message, true)) },
      image && '-',
      { label: 'New text box here', run: () => cv.createText(at.x, at.y) },
      some && { label: 'Duplicate', key: '⌘D', run: () => cv.duplicateSelected() },
      some && { label: 'Bring to front', run: () => cv.stackTo(cv.selected(), true) },
      some && { label: 'Send to back',    run: () => cv.stackTo(cv.selected(), false) },
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
    const move = m => { side.style.width = Math.max(320, Math.min(760, w0 + m.clientX - ev.clientX)) + 'px'; };
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

  on('load', () => { paintHeader(); toolbar.syncState(); toolbar.reflow(); minimap.draw(); repaintMatches(); });
  on('state', () => {
    document.body.classList.toggle('no-note', !store.path);
    $('#editor').inert = M_store.editingBlocked();
    $('#save-state').textContent = store.dirty ? 'saving…' : 'saved';
    $('#save-state').classList.toggle('dirty', store.dirty);
    paintHeader();
    toolbar.syncState();
  });
  on('saved', () => refreshLinks());

  document.addEventListener('selectionchange', debounce(() => toolbar.syncState(), 60));

  cv.mount({ onChange: () => { minimap.draw(); toolbar.syncState(); scheduleSearchRail(); } });
  minimap.mount();
  toolbar.mount();
  history.mount({ onRevert: () => { toolbar.syncState(); minimap.draw(); repaintMatches(); } });
  tree.mount({
    onOpen: go,
    onStructure: () => refreshLinks(),
    onScope: () => runSearch($('#search').value, ++searchVersion),
  });
  palette.mount({
    onOpen: go,
    commands: [
      { label: 'New note', key: '⌘N', run: () => tree.newNote() },
      { label: 'New folder', key: '⇧⌘N', run: () => tree.newFolder() },
      { label: 'History — step by step', key: '⇧⌘H', run: () => history.open() },
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
  window.wb = { store, canvas: cv, tree, richtext: rt, history, saveNow, go, undo, redo, commit };

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
};

// ══ entry points ════════════════════════════════════════════════════════════

// app/test.html imports these to round-trip notes without a browser UI, so they
// stay reachable by name.
export const { htmlToMd, mdToHtml, parseNote, serializeNote, inlineToHtml } = M_format;

// …and the store itself, with the api object it calls through, so the suite can
// hold a write open and watch what the store does with an edit made meanwhile.
export const __test = { M_store, api: M_api.api, M_table };

// Importing this file for those helpers alone must not try to wire up an app
// that isn't on the page.
if (document.getElementById('stage')) M_main();

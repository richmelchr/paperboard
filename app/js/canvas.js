// The infinite canvas: pan/zoom viewport, element rendering, selection,
// dragging, resizing, box/line/ink tools and image placement.

import { $, el, uid, clamp, toast, contrastOn } from './util.js';
import { store, commit, touchView, on } from './store.js';
import { api, imageUrl } from './api.js';
import { attachEditor, dropRange } from './richtext.js';

export const FONTS = {
  'Roboto':          "Roboto, system-ui, sans-serif",
  'JetBrains Mono':  "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  'Calibri':         "Calibri, Carlito, 'Segoe UI', sans-serif",
  'Arial':           "Arial, Helvetica, sans-serif",
  'Helvetica':       "Helvetica, 'Helvetica Neue', Arial, sans-serif",
};
export const fontStack = name => FONTS[name] || FONTS.Roboto;

const HALO = '#4a86f7';

export const view = { x: 60, y: 40, scale: 1 };
export const selection = new Set();
export const style = {          // current tool style, remembered between shapes
  stroke: '#4a7fd4', fill: 'none', strokeWidth: 2,
  arrowStart: false, arrowEnd: true, shape: 'rect',
};

/** Per-shape defaults used when a new one is drawn. */
export const SHAPES = {
  rect:   { label: 'Rectangle',   w: 200, h: 120, radius: 6 },
  ellipse:{ label: 'Ellipse',     w: 200, h: 140, radius: 6 },
  sticky: { label: 'Sticky note', w: 180, h: 180, radius: 3,
            fill: '#ffe9a8', stroke: 'none', strokeWidth: 0 },
};

let stage, world, vector, overlay, hint;
let tool = 'select';
let nodes = new Map();
let marquee = null, spaceDown = false, lastPoint = { x: 120, y: 120 };
let onChange = () => {};

const byId = id => store.doc.elements.find(e => e.id === id);
const px = n => Math.round(n * 100) / 100;

// ── coordinates ───────────────────────────────────────────────────────────

export function toWorld(clientX, clientY) {
  const r = stage.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.scale,
           y: (clientY - r.top - view.y) / view.scale };
}
const toScreen = (x, y) => ({ x: view.x + x * view.scale, y: view.y + y * view.scale });

function applyView() {
  world.style.transform = `translate(${px(view.x)}px, ${px(view.y)}px) scale(${px(view.scale)})`;
  stage.style.backgroundSize = `${24 * view.scale}px ${24 * view.scale}px`;
  stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
  drawOverlay();
  onChange();
}

export function setZoom(scale, cx, cy) {
  const r = stage.getBoundingClientRect();
  cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  const next = clamp(scale, 0.1, 6);
  view.x = cx - (cx - view.x) * (next / view.scale);
  view.y = cy - (cy - view.y) * (next / view.scale);
  view.scale = next;
  applyView(); touchView();
}

export const zoomBy = f => setZoom(view.scale * f);

export function contentBounds() {
  const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const e of store.doc.elements) {
    const r = boundsOf(e);
    b.x1 = Math.min(b.x1, r.x); b.y1 = Math.min(b.y1, r.y);
    b.x2 = Math.max(b.x2, r.x + r.w); b.y2 = Math.max(b.y2, r.y + r.h);
  }
  return isFinite(b.x1) ? b : { x1: 0, y1: 0, x2: 800, y2: 600 };
}

export function fitToContent() {
  const b = contentBounds(), r = stage.getBoundingClientRect(), pad = 60;
  const s = clamp(Math.min((r.width - pad * 2) / Math.max(b.x2 - b.x1, 1),
                           (r.height - pad * 2) / Math.max(b.y2 - b.y1, 1)), 0.1, 1.6);
  view.scale = s;
  view.x = (r.width - (b.x2 - b.x1) * s) / 2 - b.x1 * s;
  view.y = (r.height - (b.y2 - b.y1) * s) / 2 - b.y1 * s;
  applyView(); touchView();
}

export function centerOn(e) {
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

export function render() {
  const seen = new Set();
  for (const e of store.doc.elements) {
    if (e.type === 'line' || e.type === 'ink') continue;
    seen.add(e.id);
    let n = nodes.get(e.id);
    if (!n) { n = makeNode(e); nodes.set(e.id, n); world.append(n); }
    updateNode(e, n);
  }
  for (const [id, n] of nodes) if (!seen.has(id)) { n.remove(); nodes.delete(id); }
  renderVector();
  hint.hidden = store.doc.elements.some(e =>
    e.type !== 'text' || (e.html || '').replace(/<[^>]*>/g, '').trim());
  drawOverlay();
  onChange();
}

function makeNode(e) {
  const rt = el('div', { class: 'rt', spellcheck: 'false' });
  if (e.type === 'image') {
    const node = el('div', { class: 'el image', 'data-id': e.id },
      el('img', { draggable: 'false', alt: e.src || '' }));
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

export function lineEnds(l) {
  const ra = l.from ? rectOf(l.from) : null;
  const rb = l.to ? rectOf(l.to) : null;
  let a = ra ? { x: ra.cx, y: ra.cy } : { x: l.x1 ?? 0, y: l.y1 ?? 0 };
  let b = rb ? { x: rb.cx, y: rb.cy } : { x: l.x2 ?? 0, y: l.y2 ?? 0 };
  const a0 = { ...a }, b0 = { ...b };
  if (ra) a = clipToShape(ra, a0, b0);
  if (rb) b = clipToShape(rb, b0, a0);
  return { a, b };
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
      const d = `M${px(a.x)} ${px(a.y)} L${px(b.x)} ${px(b.y)}`;
      if (on) out.push(`<path d="${d}" fill="none" stroke="${HALO}" stroke-opacity=".45" stroke-width="${w + 8}" stroke-linecap="round"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`);
      const head = Math.max(9, w * 3.4);
      if (e.arrowEnd)   out.push(`<path d="${arrowHead(b, a, head)}" fill="${color}"/>`);
      if (e.arrowStart) out.push(`<path d="${arrowHead(a, b, head)}" fill="${color}"/>`);
      out.push(`<path class="hit" data-id="${e.id}" d="${d}"/>`);
    }
  }
  vector.innerHTML = out.join('');
}

// ── selection + overlay ───────────────────────────────────────────────────

export function select(ids, additive = false) {
  if (!additive) selection.clear();
  for (const id of [].concat(ids)) if (id) selection.add(id);
  for (const [id, n] of nodes) n.classList.toggle('sel', selection.has(id));
  renderVector(); drawOverlay(); onChange();
}

export const clearSelection = () => select([]);
export const selected = () => [...selection].map(byId).filter(Boolean);

const HANDLES = { text: ['e', 'w'], box: ['nw','n','ne','e','se','s','sw','w'],
                  image: ['nw','ne','se','sw'], ink: ['nw','ne','se','sw'] };

function drawOverlay() {
  overlay.innerHTML = '';
  if (marquee) {
    overlay.append(el('div', { class: 'marquee', style: {
      left: marquee.x + 'px', top: marquee.y + 'px',
      width: marquee.w + 'px', height: marquee.h + 'px' } }));
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
    for (const dir of HANDLES[e.type] || []) {
      const fx = dir.includes('w') ? 0 : dir.includes('e') ? 1 : 0.5;
      const fy = dir.includes('n') ? 0 : dir.includes('s') ? 1 : 0.5;
      overlay.append(el('div', { class: 'handle', 'data-id': e.id, 'data-dir': dir,
        style: { left: (tl.x + w * fx) + 'px', top: (tl.y + h * fy) + 'px' } }));
    }
  }
}

// ── mutation helpers ──────────────────────────────────────────────────────

export function addElement(e) {
  store.doc.elements.push(e);
  render();
  return e;
}

export function removeSelected() {
  if (!selection.size) return;
  const dead = new Set(selection);
  store.doc.elements = store.doc.elements.filter(e =>
    !dead.has(e.id) && !(e.type === 'line' && (dead.has(e.from) || dead.has(e.to))));
  clearSelection();
  render(); commit();
}

export function duplicateSelected() {
  const copies = selected().map(e => ({ ...e, id: uid(e.type[0]), x: e.x + 24, y: e.y + 24,
    from: undefined, to: undefined }));
  store.doc.elements.push(...copies);
  render(); select(copies.map(c => c.id)); commit();
}

export function applyToSelection(patch) {
  const hit = selected();
  if (!hit.length) return false;
  for (const e of hit) Object.assign(e, patch);
  render(); commit();
  return true;
}

export function createText(x, y, w = 340) {
  const e = addElement({ id: uid('t'), type: 'text', x: px(x), y: px(y), w, html: '<p><br></p>' });
  select(e.id);
  const rt = nodes.get(e.id)?.querySelector('.rt');
  if (rt) { rt.focus(); placeCaretEnd(rt); }
  commit();
  return e;
}

export async function placeImage(blob, at) {
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
  select(e.id); commit();
  toast('Saved ' + src);
  return e;
}

/** A free-ish spot in the visible viewport to drop something new. */
export function viewportAnchor() {
  const r = stage.getBoundingClientRect();
  const at = toWorld(r.left + r.width * 0.28, r.top + r.height * 0.3);
  const taken = p => store.doc.elements.some(e => {
    const b = boundsOf(e);
    return p.x > b.x - 40 && p.x < b.x + b.w && p.y > b.y - 40 && p.y < b.y + b.h;
  });
  for (let i = 0; i < 12 && taken(at); i++) { at.x += 32; at.y += 32; }
  return { x: px(at.x), y: px(at.y) };
}

export const editorFor = id => nodes.get(id)?.querySelector('.rt') || null;

function placeCaretEnd(host) {
  const r = document.createRange();
  r.selectNodeContents(host); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

// ── DOM <-> model sync ────────────────────────────────────────────────────

function syncDom() {
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

export function setTool(name) {
  tool = name;
  stage.dataset.tool = name;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
  onChange();
}
export const getTool = () => tool;

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
  const start = selected().map(e => ({ e, x: e.x, y: e.y }));
  drag(ev, (m, dx, dy) => {
    const snap = m.shiftKey ? v => Math.round(v / 8) * 8 : v => v;
    for (const s of start) { s.e.x = px(snap(s.x + dx)); s.e.y = px(snap(s.y + dy)); }
    for (const s of start) { const n = nodes.get(s.e.id); if (n) { n.style.left = s.e.x + 'px'; n.style.top = s.e.y + 'px'; } }
    renderVector(); drawOverlay();
  }, (m, moved) => { if (moved) commit(); });
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
  }, (m, moved) => { if (moved) { render(); commit(); } });
}

function moveEndpoint(ev, e, end) {
  drag(ev, m => {
    const p = toWorld(m.clientX, m.clientY);
    const hit = elementAt(m.clientX, m.clientY, e.id);
    if (end === 'a') { if (hit) { e.from = hit; } else { e.from = undefined; e.x1 = px(p.x); e.y1 = px(p.y); } }
    else            { if (hit) { e.to = hit; }   else { e.to = undefined;   e.x2 = px(p.x); e.y2 = px(p.y); } }
    renderVector(); drawOverlay();
  }, (m, moved) => { if (moved) commit(); });
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

  if (hitPath) { select(hitPath.dataset.id, ev.shiftKey); return; }

  if (node) {
    const id = node.dataset.id;
    const inText = under.closest('.rt') && node.classList.contains('sel');
    const editable = under.closest('.rt') && node.classList.contains('text');
    if (!selection.has(id)) select(id, ev.shiftKey);
    else if (ev.shiftKey) { selection.delete(id); select([...selection]); return; }
    if (ev.altKey || (!inText && !editable)) { ev.preventDefault(); moveSelection(ev); }
    return;
  }

  // empty canvas
  dropRange();                       // the caret is no longer anywhere useful
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
    render(); select(e.id); commit(); setTool('select');
  });
}

function dragNewLine(ev, fromId) {
  const p = toWorld(ev.clientX, ev.clientY);
  const e = addElement({ id: uid('l'), type: 'line',
    ...(fromId ? { from: fromId } : { x1: px(p.x), y1: px(p.y) }),
    x2: px(p.x), y2: px(p.y),
    stroke: style.stroke, strokeWidth: style.strokeWidth,
    arrowStart: style.arrowStart, arrowEnd: style.arrowEnd });
  drag(ev, m => {
    const q = toWorld(m.clientX, m.clientY);
    const over = elementAt(m.clientX, m.clientY, e.id);
    if (over && over !== fromId) { e.to = over; }
    else {
      e.to = undefined;
      let { x, y } = q;
      if (m.shiftKey) {
        const ax = Math.abs(x - p.x), ay = Math.abs(y - p.y);
        if (ax > ay * 2) y = p.y; else if (ay > ax * 2) x = p.x;
      }
      e.x2 = px(x); e.y2 = px(y);
    }
    renderVector();
  }, (m, moved) => {
    const { a, b } = lineEnds(e);
    if (!moved || (Math.hypot(b.x - a.x, b.y - a.y) < 8 && !e.to)) {
      store.doc.elements = store.doc.elements.filter(x => x !== e);
      render(); return;
    }
    render(); select(e.id); commit(); setTool('select');
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
    render(); commit();
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

export function mount(opts = {}) {
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
    nodes.forEach(n => n.remove());
    nodes.clear();
    selection.clear();
    const v = store.doc.meta.view;
    if (v && isFinite(v.scale)) { view.x = v.x; view.y = v.y; view.scale = v.scale || 1; }
    applyView();
    render();
  });
}

export const isTyping = () => {
  const a = document.activeElement;
  return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
};

export { nodes };

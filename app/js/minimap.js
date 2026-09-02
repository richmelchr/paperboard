// A small overview of the page, since an infinite canvas is easy to get lost on.

import { $ } from './util.js';
import { store } from './store.js';
import * as cv from './canvas.js';

let map = null;

export function draw() {
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

export function mount() {
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

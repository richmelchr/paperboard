// Exporting a page: PNG by rasterising the canvas, PDF through the print
// dialog (macOS offers "Save as PDF" there, which beats bundling a PDF writer).

import { $, toast } from './util.js';
import { store } from './store.js';
import * as cv from './canvas.js';

const PAD = 48;

/** Everything the export needs that lives outside the cloned markup. */
async function inlineStyles() {
  const sheets = ['css/fonts.css', 'css/theme.css', 'css/app.css'];
  const texts = await Promise.all(sheets.map(u => fetch(u).then(r => r.text())));
  let css = texts.join('\n');

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

export async function exportSvg() {
  const { markup } = await buildSvg(1);
  download(new Blob([markup], { type: 'image/svg+xml' }), fileName('svg'));
  toast('Saved ' + fileName('svg'));
}

export async function exportPng(scale = 2) {
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
export function exportPdf() {
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

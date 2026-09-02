// Thin wrapper over the server's JSON API.

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

export const api = {
  tree:      ()               => req('/api/tree'),
  read:      path             => req('/api/note?' + q({ path })),
  write:     (path, text)     => req('/api/note?' + q({ path }), { method: 'PUT', body: text }),
  create:    (path, kind)     => post('/api/create', { path, kind }),
  rename:    (from, to)       => post('/api/rename', { from, to }),
  remove:    path             => post('/api/delete', { path }),
  setColor:  (path, color)    => post('/api/color', { path, color }),
  search:    text             => req('/api/search?' + q({ q: text })),
  links:     ()               => req('/api/links'),
  history:   path             => req('/api/history?' + q({ path })),
  version:   (path, at)       => req('/api/history?' + q({ path, at })),
  restore:   (path, at)       => post('/api/restore', { path, at }),
  changes:   since            => req('/api/changes?' + q({ since })),
  upload:    (path, ext, blob) =>
    req('/api/image?' + q({ path, ext }), { method: 'POST', body: blob }),
};

/** URL at which the browser can load an image referenced from a note. */
export const imageUrl = (notePath, src) => {
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '';
  return '/notes/' + (dir + src).split('/').map(encodeURIComponent).join('/');
};

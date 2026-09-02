// Document state: the open note, undo/redo history, autosave, and reacting to
// edits made to the files outside the app.

import { api } from './api.js';
import { parseNote, serializeNote, blankDoc } from './format.js';
import { stamp, debounce, stemOf, toast } from './util.js';

const listeners = {};
export const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
const fire = (evt, ...a) => (listeners[evt] || []).forEach(f => f(...a));

const HISTORY_LIMIT = 250;
const COALESCE_MS = 900;
const KEEP_HISTORIES = 24;      // notes whose undo stack survives a switch

/** Undo stacks parked by note path, so switching pages doesn't lose them. */
const parked = new Map();

export const store = {
  path: null,
  doc: blankDoc('Untitled'),
  savedText: '',
  dirty: false,
  history: [],
  index: -1,
  coalesceUntil: 0,
  /** Set by canvas.js: flush contenteditable DOM back into the model. */
  sync: () => {},
  /** Set by canvas.js: describe / restore the caret across an undo. */
  readCaret: () => null,
  writeCaret: () => {},
};

const contentKey = doc => JSON.stringify({
  ...doc.meta, view: null, modified: null, elements: doc.elements,
});

// ── loading ───────────────────────────────────────────────────────────────

export async function open(path) {
  if (store.dirty) await saveNow();
  if (store.path && store.history.length) {
    parked.delete(store.path);                     // re-insert to keep it recent
    parked.set(store.path, { history: store.history, index: store.index });
    while (parked.size > KEEP_HISTORIES) parked.delete(parked.keys().next().value);
  }
  const { text, mtime } = await api.read(path);
  store.path = path;
  store.doc = parseNote(text, stemOf(path));
  store.savedText = text;
  store.savedContentKey = contentKey(store.doc);
  store.mtime = mtime;
  store.dirty = false;
  store.coalesceUntil = 0;

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
  fire('load', store.doc);
  fire('state');
  localStorage.setItem('wb:last', path);
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
 * single step, so one ⌘Z undoes a word, not a letter.
 */
export function commit({ coalesce = false } = {}) {
  store.sync();
  const snap = JSON.stringify(store.doc);
  const top = store.history[store.index];
  if (top && top.snap === snap) return;

  const caret = store.readCaret();
  if (coalesce && Date.now() < store.coalesceUntil && top) {
    store.history[store.index] = { snap, caret: top.caret };
  } else {
    pushSnapshot(caret);
  }
  store.coalesceUntil = coalesce ? Date.now() + COALESCE_MS : 0;
  touch();
}

function restore(entry) {
  store.doc = JSON.parse(entry.snap);
  store.coalesceUntil = 0;
  fire('load', store.doc);
  if (entry.caret) store.writeCaret(entry.caret);
  touch();
}

export function undo() {
  store.sync();
  // An uncommitted edit is itself a step back to.
  if (JSON.stringify(store.doc) !== store.history[store.index]?.snap) commit();
  if (store.index <= 0) return false;
  restore(store.history[--store.index]);
  return true;
}

export function redo() {
  if (store.index >= store.history.length - 1) return false;
  restore(store.history[++store.index]);
  return true;
}

export const canUndo = () => store.index > 0;
export const canRedo = () => store.index < store.history.length - 1;

// ── saving ────────────────────────────────────────────────────────────────

function touch() {
  store.dirty = true;
  fire('state');
  autosave();
}

const autosave = debounce(() => { saveNow().catch(e => toast(e.message, true)); }, 700);

export async function saveNow() {
  autosave.cancel();
  if (!store.path) return;
  store.sync();
  const changed = contentKey(store.doc) !== store.savedContentKey;
  if (changed) store.doc.meta.modified = stamp();
  const text = serializeNote(store.doc);
  if (text === store.savedText) {
    store.dirty = false; fire('state'); return;
  }
  const res = await api.write(store.path, text);
  store.savedText = text;
  store.savedContentKey = contentKey(store.doc);
  store.mtime = res.mtime;
  store.dirty = false;
  fire('state');
  fire('saved');
}

/** Mark view-only changes (pan/zoom) — persisted, but never bump `modified`. */
export function touchView() {
  if (!store.path) return;
  store.dirty = true;
  fire('state');
  autosave();
}

// ── external file changes ─────────────────────────────────────────────────

let lastPoll = Date.now() / 1000;
let lastCount = -1;

export function startWatching(onStructureChange) {
  setInterval(async () => {
    try {
      const { now, changed, count } = await api.changes(lastPoll);
      lastPoll = now;
      if (count !== lastCount) { lastCount = count; onStructureChange(); }
      if (!changed.length) return;
      if (changed.includes(store.path) && store.mtime && !store.dirty) {
        const fresh = await api.read(store.path);
        if (fresh.text !== store.savedText) {
          store.doc = parseNote(fresh.text, stemOf(store.path));
          store.savedText = fresh.text;
          store.savedContentKey = contentKey(store.doc);
          store.mtime = fresh.mtime;
          pushSnapshot(null);
          fire('load', store.doc);
          toast('Reloaded — changed on disk');
        }
      } else if (changed.includes(store.path) && store.dirty) {
        toast('This note also changed on disk; your version will win on save.', true);
      }
      onStructureChange();
    } catch { /* server restarting; try again next tick */ }
  }, 2500);
}

window.addEventListener('beforeunload', e => {
  if (store.dirty) { saveNow(); e.preventDefault(); e.returnValue = ''; }
});

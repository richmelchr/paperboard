// Editing an existing table: rows, columns, merging, splitting and rules.
//
// Everything here works off a grid map — a row-major array where a cell that
// spans several rows or columns appears once per position it occupies. That is
// what makes "the cell below this one" and "column index 3" well defined once
// merges are in play.

/** Row-major map of the table; `grid[r][c]` is the cell occupying that slot. */
export function gridOf(table) {
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

export const cellOf = node =>
  (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('th, td') || null;
export const tableOf = node =>
  (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('table') || null;

// ── rows ──────────────────────────────────────────────────────────────────

export function insertRow(table, cell, below) {
  const g = gridOf(table);
  const at = locate(g, cell);
  if (!at) return;
  const index = below ? at.r + (cell.rowSpan || 1) : at.r;
  const row = document.createElement('tr');
  for (let c = 0; c < g.width; c++) {
    // A cell spanning across the seam grows instead of being duplicated.
    const above = index > 0 ? g.grid[index - 1]?.[c] : null;
    const here = g.grid[index]?.[c];
    if (above && here && above === here) { above.rowSpan += 1; continue; }
    row.appendChild(like(g.grid[at.r][c] || cell, 'td'));
  }
  const anchor = g.rows[index];
  if (anchor) anchor.parentNode.insertBefore(row, anchor);
  else (table.tBodies[0] || table).appendChild(row);
}

export function deleteRow(table, cell) {
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

export function insertColumn(table, cell, after) {
  const g = gridOf(table);
  const at = locate(g, cell);
  if (!at) return;
  const index = after ? at.c + (cell.colSpan || 1) : at.c;
  for (let r = 0; r < g.rows.length; r++) {
    const left = index > 0 ? g.grid[r][index - 1] : null;
    const here = g.grid[r][index];
    if (left && here && left === here) { left.colSpan += 1; continue; }
    const occupant = g.grid[r][index] || g.grid[r][index - 1];
    if (occupant && locate(g, occupant).r !== r) continue;   // covered by a rowspan
    const model = g.grid[r][at.c] || occupant || cell;
    g.rows[r].insertBefore(like(model, model.tagName.toLowerCase()),
                           here && locate(g, here).r === r ? here : null);
  }
}

export function deleteColumn(table, cell) {
  const g = gridOf(table);
  const at = locate(g, cell);
  if (!at || g.width < 2) return;
  const dead = new Set();
  for (let r = 0; r < g.rows.length; r++) {
    const occupant = g.grid[r][at.c];
    if (!occupant) continue;
    if (occupant.colSpan > 1) occupant.colSpan -= 1;
    else dead.add(occupant);
  }
  dead.forEach(c => c.remove());
  [...table.querySelectorAll('tr')].forEach(r => { if (!r.children.length) r.remove(); });
}

// ── merge and split ───────────────────────────────────────────────────────

const absorb = (into, from) => {
  const text = from.textContent.trim();
  if (!text) return;
  if (!into.textContent.trim()) into.innerHTML = from.innerHTML;
  else into.innerHTML += '<br>' + from.innerHTML;
};

export function mergeRight(table, cell) {
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

export function mergeDown(table, cell) {
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

export const isMerged = cell => cell.colSpan > 1 || cell.rowSpan > 1;

export function splitCell(table, cell) {
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

export function toggleBorders(table) {
  if (table.dataset.borders === 'off') delete table.dataset.borders;
  else table.dataset.borders = 'off';
}

export const bordersOn = table => table.dataset.borders !== 'off';

export function toggleHeaderRow(table) {
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

export const hasHeaderRow = table => table.querySelector('tr')?.children[0]?.tagName === 'TH';

// ── caret movement ────────────────────────────────────────────────────────

/** Tab / ⇧Tab hop between cells. Returns false at the ends of the table. */
export function moveToCell(cell, back) {
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

export function newTable(rows, cols, withHeader = true) {
  const cell = t => `<${t}><br></${t}>`;
  const head = withHeader ? `<tr>${cell('th').repeat(cols)}</tr>` : '';
  const body = `<tr>${cell('td').repeat(cols)}</tr>`.repeat(Math.max(0, rows - (withHeader ? 1 : 0)));
  return `<table>${head}${body}</table>`;
}

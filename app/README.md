# Paper

A local, file-backed notebook that runs in your browser. OneNote's shape —
coloured section folders, free-form pages, an infinite canvas — but every page
is a plain Markdown file you own, sitting in `notes/`.

No database, no build step, no dependencies. Python's standard library serves
it; the browser does the rest.

```sh
./app/paper              # http://127.0.0.1:8420, opens your browser
./app/paper --port 9000  # or --host, --no-open
```

---

## The folders *are* the notebook

`notes/` is the notebook. The first navigation column contains root folders
and loose root notes; selecting a folder fills the second column with its
direct pages. Paper deliberately supports one folder level only. If nested
folders exist on disk, they and their notes stay untouched but are omitted
from navigation and search.

Rename a root folder in Finder and the app follows on its next poll; rename it
in the app and the file moves. Deleting moves things to `notes/.trash/` rather
than erasing them.

```
notes/
├── Welcome.md
├── images/                     ← images pasted into Welcome
│   └── Welcome1.png
├── Projects/
│   ├── Kickoff.md
│   ├── Architecture.md
│   └── images/
│       └── Kickoff1.png        ← images pasted into Kickoff
└── Reference/
    └── Keyboard shortcuts.md
```

Folder colours live in `notes/.paper.json` — the one piece of metadata
that has nowhere natural to live inside a note. A folder's name is written in
its own colour, so the chip and the word read as one thing. Deleted notes go to
`notes/.trash/`, and earlier versions to `notes/.history/`; both are hidden
from the sidebar, from search and from git.

Notes can be tagged with exactly one of ❤️, 🔥, 🍕 or 🌴 from their context
menu. The same four buttons beside **Paper** filter both navigation columns;
the assignments also live in `notes/.paper.json`.

The project is a git repository, so `git log` is the long-term history and
`notes/.history/` is the ten-minute one.

### Order, and the archive

Drag a folder or a page up and down its own column to put it where you want
it; a line shows where it will land. What you arrange is remembered in
`notes/.paper.json` and is the order the sidebar comes back with, on the next
reload and on the next machine. Anything you have never moved — a folder made
this morning, a `.md` file dropped into `notes/` from somewhere else — sorts by
name after the ones you have.

Below the first column sits **Archive**, shut until you click it and then
opening upwards over at most half the column. Drag a folder onto it to put the
folder away: nothing moves on disk, and the folder still opens, holds its
colour and answers `[[links]]` — it is simply out of the first column. Drag it
back out, or use the folder's own right-click menu, to bring it back.

Archived pages are left out of search. The checkbox beside **Archive** puts
them back in, and stays how you left it.

## The file format

Each note is one Markdown file. YAML frontmatter holds the metadata and the
geometry of everything on the canvas; the body holds your prose, one Markdown
block per text-bearing element, introduced by an `<!--@id-->` marker.

```markdown
---
title: Kickoff
created: 01SEP2026
modified: 12SEP2026
font: Roboto
view: "60,40,1"
elements:
  - id: t1
    type: text
    x: 60
    y: 40
    w: 600
  - id: b1
    type: box
    x: 700
    y: 60
    w: 220
    h: 96
    fill: none
    stroke: "#4a7fd4"
    strokeWidth: 2
    radius: 8
  - id: l1
    type: line
    from: b1
    to: b2
    arrowEnd: true
---

<!--@t1-->
# Agenda

- Scope review
- <span style="background:#ffe479">Budget signoff</span>
```

**Why this and not JSON.** Plain Markdown can't express *where* something sits
on an infinite canvas, and JSON can't be read by a human or diffed usefully.
Splitting them keeps the prose — the part you actually care about in ten
years — readable, greppable and portable, while the geometry stays out of the
way in the header. Any note opened in a text editor still reads as a document.

Element types: `text`, `box`, `line`, `ink`, `image`. Boxes take a `shape` of
`ellipse` or `sticky`. Text colour, highlight and size are the one place inline
HTML appears (`<span style="color:…;font-size:20px">`), because Markdown has no
syntax for them.

Code blocks use fenced Markdown. Paper preserves their indentation, blank
lines, trailing spaces, literal HTML characters and an optional simple language
name such as `python`; when the code itself contains backticks, it writes a
longer fence so the block still closes in the right place.

Tables are GFM pipe tables while they can be. A table carrying anything a pipe
table cannot spell — including no header row, merged cells, hidden rules, row
numbers, a line colour, dragged column widths or row heights — is written as a
raw HTML block instead, still legal Markdown and still readable:

```html
<table data-numbers="on" style="table-layout: fixed; width: 420px;">
<colgroup><col style="width: 120px;"><col style="width: 300px;"></colgroup>
<tr style="height: 40px;"><th colspan="2">Storage</th></tr>
<tr><td>prose</td><td>Markdown body</td></tr>
</table>
```

The frontmatter deliberately uses a tiny YAML subset — scalars and a list of
flat maps — so both the browser and `server.py` parse it without a library.

Hand-edit a note in your editor and the app reloads it within a couple of
seconds. Drop a plain `.md` file into `notes/` with no frontmatter at all and
it opens as a single text box.

**Imported files.** A `.md` file that already carries someone else's
frontmatter — a `title:` and a `tags:` list from another notes app, say — opens
the same way: with no `elements:` to lay out, the whole body becomes one text
box. Frontmatter keys Paper does not own (anything but `title`, `created`,
`modified`, `font`, `view` and `elements`) are never interpreted, but they are
kept verbatim and written back in place, so opening and saving a note is never
the reason a field disappeared. The same rule applies inside the body: prose
above the first `<!--@id-->` marker, or a block whose element definition is
missing or malformed, is adopted into a text box below the rest rather than
dropped.

### Images

Pasting or dropping an image saves it beside the note, in that folder's
`images/` directory, named after the note: `Kickoff1.png`, `Kickoff2.png`, and
so on. Rename the note and its images are renamed with it. The absolute local
file path appears directly below the image by default. Right-click the image
to hide/show that label or copy the path.

## Search

The sidebar search hides every note and folder that doesn't match, opens the
first matching page as you type, and lights up every match in that page —
including matches in text you are editing at that moment. It takes
uppercase boolean operators, quoted phrases and parentheses; adjacent terms are
an implicit AND.

```
budget                          budget AND NOT draft
"risk register"                 (kickoff OR architecture) AND risk
scope storage                   risk NOT budget
```

Lowercase `and` is just a word, so searching for `black and white` works.
Terms behind a `NOT` are never highlighted. Folders in the archive are not
searched unless the checkbox beside **Archive** says they are.

## Linking

`[[Note name]]` links to another note; click it to jump there, and each note
shows in its header which other notes point at it. If the target doesn't exist,
clicking offers to create it.

Pasting a URL over selected text turns that text into a link, the way Slack
does. ⌘-click a link to open it.

## Keyboard

| Keys | |
| --- | --- |
| ⌘K | Command palette (or, while typing, insert a link) |
| ⌘F | Search · ⌘N new note · ⇧⌘N new folder |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘B ⌘I ⌘U | Bold, italic, underline |
| ⌘V / ⌘⇧V | Paste plain / paste with formatting |
| ⌘0 / ⌘1 | Reset zoom / fit page to content |
| ⌘⇧D | Toggle dark mode |
| ⌘D | Duplicate selection · ⌫ delete |
| ⌘\\ | Clear formatting from the selection |
| ⌘/ | Hide or show the left pane |
| ⇧⌘H | History — the steps taken on this page |
| ⇧⌘P | Print, or save as PDF |
| V T P R L H | Select, text, draw, box, connector, pan |
| Space-drag | Pan · ⌘-scroll to zoom · arrows nudge |
| Tab | Next table cell, or indent inside a list |

Typing `- ` starts a bullet, `1. ` a numbered list, `# ` `## ` `### ` a heading
and `> ` a quote. Tab and ⇧Tab indent inside lists.

Chrome spellchecking is enabled in note titles and text boxes. An ordinary
right-click inside any editor — text box, sticky note, table cell, or over a
selection — opens Paper's own menu, with cut, copy, paste, select all and the
formatting and table commands. Option-right-click falls through to Chrome's
native menu, which is the only way to reach Inspect and the spelling
suggestions: a page cannot open either of those itself.

## Tables

Insert one with **▦**. If the caret is in a text box it lands there; if it
isn't, it arrives in a new box of its own on the canvas.

Right-click any cell to edit the table: insert or delete rows and columns,
delete the table, merge a cell with the one to its right or below, split a
merged cell back apart, hide or show the rules, and turn the header row on or
off. Tab walks the cells, and tabbing past the last one adds a row.

Put the caret in a cell and the **Table** row appears, floating over the top of
the page rather than pushing it down. Alongside the row and column commands it
carries:

- **#** — a gutter of row numbers down the left. It is drawn, not stored: there
  is no extra column to sort, type in or trip over.
- **⇅ Sort** — sorts the rows on the column the caret is in. Click again for the
  other direction. Numbers sort as numbers, blanks sink to the bottom, and a
  header row stays put.
- **W** and **H** — the width of the selected column and the height of its row,
  in pixels. They show what is there and set what you type.

The per-cell tools — add and delete rows and columns, merge, split, sort, W and
H — need to know *which* cell, so they stay greyed out until the caret is in
one. Selecting a box that happens to hold a table still gets you the
whole-table switches: Header, Rules, **#** and Delete table.

You can also drag a column's right edge or a row's bottom edge; the cursor
changes when you are on one. The first drag freezes every column at the width it
already had, so widening one column no longer steals room from its neighbours.

The **╱** line-colour swatch in the main toolbar paints the table's rules while
the caret is in a cell — it goes back to shapes as soon as one is selected.

## Shapes and export

The **▾** beside the box tool chooses rectangle, ellipse or sticky note.
Connectors meet an ellipse on its curve rather than its bounding box.

Export lives in the command palette (⌘K): the page goes out as a PNG (2×,
everything inlined so it renders anywhere), as an SVG, or through the print
dialog — ⇧⌘P, where macOS offers *Save as PDF*.

## Themes

Light "paper" by default — warm off-white with a faint fibre texture. Dark mode
is IntelliJ IDEA's Islands Darcula: panels float as rounded islands on a darker
gutter.

Fonts are Roboto, JetBrains Mono, Calibri, Arial and Helvetica. Roboto and
JetBrains Mono are vendored in `app/fonts/` (latin subset, ~230 KB), so the app
never touches the network. Font and size apply per element rather than per
character, which is what keeps the Markdown clean.

## Layout of the code

```
app/paper           launcher
app/server.py       REST API, static files, boolean search, backlinks — stdlib only
app/index.html      the shell
app/css/app.css     fonts, both palettes, then layout and canvas chrome
app/js/app.js       the whole front end
app/test.html       front-end regression suite — open it in the browser
app/test_server.py  backend regression suite — python3 -m unittest -v app/test_server.py
```

`app/js/app.js` is one file, but it is still built out of the same sections it
grew from. Each one is an IIFE that hands back only what the rest of the app
uses, so its private helpers stay private, and they are ordered so that each
runs after whatever it depends on:

```
util · api      DOM and string helpers; the fetch wrapper
format          the note format: frontmatter + Markdown ⇄ HTML
table · menu    table grid surgery; the shared context menu
store           open note, undo/redo, autosave, external-change watching
richtext        formatting, paste rules, auto-transforms, editor menu
canvas          viewport, elements, selection, box/line/ink tools
minimap · export · tree · palette · toolbar
main            wiring: theme, note lifecycle, header, search, shortcuts
```

`app/css/app.css` is likewise one sheet in three sections, in the order the
cascade needs: the vendored `@font-face` rules, the theme custom properties,
then everything that reads them.

`app/test.html` is the front-end regression suite. It covers format and
whole-file round trips, timeout-isolated parsing, merged-table edits, save and
file-lifecycle timing, and stale navigation responses. It imports the shipped
helpers and store from `app/js/app.js`; the store runs against controlled API
promises and in-memory browser storage, so it never changes the notebook,
notebook metadata, or the app's normal browser storage. Start Paper and open
<http://127.0.0.1:8420/test.html>. The heading and tab title must report the
full result: `214 passed, 0 failed`.

`app/test_server.py` covers what a browser cannot see: it runs the real handler over
HTTP against a throwaway notebook in a temporary directory — your own notes are
never opened — and asserts that renaming or moving a note carries its own images
and only its own, and that the versions and action steps kept for it come along
still pointing at the files those images are now. It also fault-injects failed
atomic replacements, checks that readers see only complete files, and verifies
that overlapping metadata changes are serialized. It also covers the sidebar
order and the archive: that a dragged order outlives the process that saved it,
that renaming or trashing something keeps its place or forgets it, and that an
archived folder stays out of search until it is asked for. Run
`python3 -m unittest -v app/test_server.py` after changing `app/server.py`; the expected
result is all 28 tests passing followed by `OK`. It needs nothing installed.

For a final release check, run both suites, then run:

```sh
python3 -m py_compile app/server.py app/test_server.py
git diff --check
```

Both commands should finish silently with exit status 0.

`window.wb` is exposed in the console (`wb.store.doc`, `wb.canvas.selected()`).

## History

**H** in the sidebar — or ⇧⌘H — opens the History page: the named steps taken on
the open note, newest first, up to a hundred. Pasting, cutting, deleting
objects, colour changes, row and column edits, sorting, resizing. Typing is
deliberately absent; ⌘Z is for that, and a keystroke log would bury everything
worth finding.

Each step holds the whole document as it stood afterwards, so clicking one puts
the page back the way it was — and the jump is itself a step, so it can be
undone in turn. The log is saved beside the note in `notes/.history/` and is
still there after a restart.

## Version history

Every ten minutes of editing, the previous contents of a note are kept in
`notes/.history/`, up to thirty versions per note. Right-click a note in the
sidebar and choose **Version history…** to see them and roll one back; the
state you were in is always snapshotted first, so a restore is itself
undoable.

Renaming or moving a note takes its history with it, and brings it into step:
the images that moved with the note and the title that followed its filename
are rewritten in every kept version and every step on the History page — and in
the undo stacks still held in memory — so restoring something from before the
rename never lands on a picture that is no longer there.

## Known edges

- Autosave writes ~0.7 s after you stop; ⌘S forces it.
- If you edit a note on disk *and* in the app at the same time, the app warns
  and its version wins on save.
- Undo history is kept per note for the 24 most recent notes you have opened,
  and is cleared when the app is reloaded. The History page outlives a reload;
  the undo stack does not.
- Live search highlighting needs the CSS Custom Highlight API (Chrome 105+,
  Safari 17.2+). Without it, search still filters the sidebar.
- Below roughly a 1400px window the shape controls fold into the **◈** button;
  narrower still and the toolbar wraps to two rows.
- PNG export rasterises through an inlined SVG. If a page ever fails to
  render, Export as SVG always works.

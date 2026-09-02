# Paperboard

A local, file-backed notebook that runs in your browser. OneNote's shape —
coloured section folders, free-form pages, an infinite canvas — but every page
is a plain Markdown file you own, sitting in `notes/`.

No database, no build step, no dependencies. Python's standard library serves
it; the browser does the rest.

```sh
./paperboard              # http://127.0.0.1:8420, opens your browser
./paperboard --port 9000  # or --host, --no-open
```

---

## The tree *is* the folder

`notes/` is the notebook. What you see in the sidebar is exactly what is on
disk — rename a folder in Finder and the app follows on its next poll; rename
it in the app and the file moves. Deleting moves things to `notes/.trash/`
rather than erasing them.

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

Folder colours live in `notes/.paperboard.json` — the one piece of metadata
that has nowhere natural to live inside a note. Deleted notes go to
`notes/.trash/`, and earlier versions to `notes/.history/`; both are hidden
from the sidebar, from search and from git.

The project is a git repository, so `git log` is the long-term history and
`notes/.history/` is the ten-minute one.

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

Tables are GFM pipe tables while they can be. Merged cells and hidden rules have
no pipe-table spelling, so such a table is written as a raw HTML block instead —
still legal Markdown, and still readable:

```html
<table data-borders="off">
<tr><th colspan="2">Storage</th></tr>
<tr><td>prose</td><td>Markdown body</td></tr>
</table>
```

The frontmatter deliberately uses a tiny YAML subset — scalars and a list of
flat maps — so both the browser and `server.py` parse it without a library.

Hand-edit a note in your editor and the app reloads it within a couple of
seconds. Drop a plain `.md` file into `notes/` with no frontmatter at all and
it opens as a single text box.

### Images

Pasting or dropping an image saves it beside the note, in that folder's
`images/` directory, named after the note: `Kickoff1.png`, `Kickoff2.png`, and
so on. Rename the note and its images are renamed with it.

## Search

The sidebar search hides every note and folder that doesn't match, and every
match in the page you have open lights up as you type — including matches in
text you are editing at that moment. It takes
uppercase boolean operators, quoted phrases and parentheses; adjacent terms are
an implicit AND.

```
budget                          budget AND NOT draft
"risk register"                 (kickoff OR architecture) AND risk
scope storage                   risk NOT budget
```

Lowercase `and` is just a word, so searching for `black and white` works.
Terms behind a `NOT` are never highlighted.

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
| ⇧⌘P | Print, or save as PDF |
| V T P R L H | Select, text, draw, box, connector, pan |
| Space-drag | Pan · ⌘-scroll to zoom · arrows nudge |
| Tab | Next table cell, or indent inside a list |

Typing `- ` starts a bullet, `1. ` a numbered list, `# ` `## ` `### ` a heading
and `> ` a quote. Tab and ⇧Tab indent inside lists.

## Tables

Insert one with **▦**. If the caret is in a text box it lands there; if it
isn't, it arrives in a new box of its own on the canvas.

Right-click any cell to edit the table: insert or delete rows and columns,
delete the table, merge a cell with the one to its right or below, split a
merged cell back apart, hide or show the rules, and turn the header row on or
off. Tab walks the cells, and tabbing past the last one adds a row.

## Shapes and export

The **▾** beside the box tool chooses rectangle, ellipse or sticky note.
Connectors meet an ellipse on its curve rather than its bounding box.

**⤓** exports the page as a PNG (2×, everything inlined so it renders anywhere),
as an SVG, or through the print dialog — where macOS offers *Save as PDF*.

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
server.py         REST API, static files, boolean search, backlinks — stdlib only
app/index.html    the shell
app/css/          theme.css (both palettes), app.css, fonts.css
app/js/format.js  the note format: frontmatter + Markdown ⇄ HTML
app/js/store.js   open note, undo/redo, autosave, external-change watching
app/js/canvas.js  viewport, elements, selection, box/line/ink tools
app/js/richtext.js  formatting, paste rules, auto-transforms, editor menu
app/js/tree.js    sidebar, folder colours, rename, drag-to-move, filtering
app/js/toolbar.js · palette.js · minimap.js · menu.js · main.js
app/test.html     round-trip tests for the file format — open it in the browser
```

`app/test.html` is the only test suite, and it's the one that matters: it
asserts that HTML → Markdown → HTML and whole-file save → load are lossless.
Open <http://127.0.0.1:8420/test.html> after changing `format.js`.

`window.wb` is exposed in the console (`wb.store.doc`, `wb.canvas.selected()`).

## Version history

Every ten minutes of editing, the previous contents of a note are kept in
`notes/.history/`, up to thirty versions per note. Right-click a note in the
sidebar and choose **Version history…** to see them and roll one back; the
state you were in is always snapshotted first, so a restore is itself
undoable.

## Known edges

- Autosave writes ~0.7 s after you stop; ⌘S forces it.
- If you edit a note on disk *and* in the app at the same time, the app warns
  and its version wins on save.
- Undo history is kept per note for the 24 most recent notes you have opened,
  and is cleared when the app is reloaded.
- Live search highlighting needs the CSS Custom Highlight API (Chrome 105+,
  Safari 17.2+). Without it, search still filters the sidebar.
- Below roughly a 1400px window the shape controls fold into the **◈** button;
  narrower still and the toolbar wraps to two rows.
- PNG export rasterises through an inlined SVG. If a page ever fails to
  render, Export as SVG always works.

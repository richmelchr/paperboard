# Whiteboard

A local, file-backed notebook that runs in your browser. OneNote's shape —
coloured section folders, free-form pages, an infinite canvas — but every page
is a plain Markdown file you own, sitting in `notes/`.

No database, no build step, no dependencies. Python's standard library serves
it; the browser does the rest.

```sh
./whiteboard              # http://127.0.0.1:8420, opens your browser
./whiteboard --port 9000  # or --host, --no-open
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

Folder colours live in `notes/.whiteboard.json` — the one piece of metadata
that has nowhere natural to live inside a note.

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

Element types: `text`, `box`, `line`, `ink`, `image`. Text colour and highlight
are the one place inline HTML appears (`<span style="color:…">`), because
Markdown has no syntax for them.

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

The sidebar search hides every note and folder that doesn't match. It takes
uppercase boolean operators, quoted phrases and parentheses; adjacent terms are
an implicit AND.

```
budget                          budget AND NOT draft
"risk register"                 (kickoff OR architecture) AND risk
scope storage                   risk NOT budget
```

Lowercase `and` is just a word, so searching for `black and white` works.

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
| V T P R L H | Select, text, draw, box, connector, pan |
| Space-drag | Pan · ⌘-scroll to zoom · arrows nudge |

Typing `- ` starts a bullet, `1. ` a numbered list, `# ` `## ` `### ` a heading
and `> ` a quote. Tab and ⇧Tab indent inside lists.

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

## Known edges

- Autosave writes ~0.7 s after you stop; ⌘S forces it.
- If you edit a note on disk *and* in the app at the same time, the app warns
  and its version wins on save.
- Undo history is per session and resets when you switch notes.
- Font size is per text box, not per word — see the format note above.

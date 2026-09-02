---
title: Welcome
created: 01SEP2026
modified: 02SEP2026
font: Roboto
view: "40,20,1"
elements:
  - id: t1
    type: text
    x: 60
    y: 40
    w: 560
  - id: t2
    type: text
    x: 60
    y: 470
    w: 560
  - id: b1
    type: box
    x: 700
    y: 60
    w: 230
    h: 100
    fill: none
    stroke: "#4a7fd4"
    strokeWidth: 2
    radius: 8
  - id: b2
    type: box
    shape: sticky
    x: 700
    y: 300
    w: 200
    h: 150
    fill: "#ffe9a8"
    stroke: none
    strokeWidth: 0
    radius: 3
  - id: l1
    type: line
    from: b1
    to: b2
    arrowStart: false
    arrowEnd: true
    stroke: "#8a63c9"
    strokeWidth: 2
  - id: k1
    type: ink
    x: 690
    y: 500
    w: 240
    h: 70
    bw: 240
    bh: 70
    d: M4 46 Q42 4 80 46 T156 46 T230 30
    stroke: "#5aa552"
    strokeWidth: 3
---

<!--@t1-->
# Welcome

This page is a plain Markdown file at `notes/Welcome.md`. The folders and files
in the sidebar *are* the folders and files on disk — nothing is hidden away in
a database.

## Getting around

- **Double-click** anywhere on the canvas to start a new text box
- Hold **space** and drag to pan, or **⌘-scroll** to zoom
- **⌘K** opens the command palette, **⌘F** jumps to search
- Tool keys: **V** select · **T** text · **P** draw · **R** box · **L** connector

## Formatting

Typing `- ` starts a bullet, `1. ` a numbered list, `## ` a heading and `> ` a
quote. Text can be <span style="color:#b8443a">coloured</span>,
<span style="background:#ffe479">highlighted</span> or
<span style="font-size:22px">resized</span>, and paste is plain by default —
right-click for **Paste with formatting**.

<!--@t2-->
## Try it

1. Paste a screenshot — it lands in `notes/images/Welcome1.png`
2. Draw a box with **R**, use the **▾** beside it for ellipses and sticky notes
3. Insert a table anywhere with **▦**, then right-click a cell to edit it
4. Search the sidebar with `budget AND NOT draft` — matches light up as you type

See also [[Kickoff]] and [[Keyboard shortcuts]].

<!--@b1-->
**Boxes** hold text too — click once to select, again to type.

<!--@b2-->
Sticky notes and ellipses come from the shape menu.

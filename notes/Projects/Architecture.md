---
title: Architecture
created: 01SEP2026
modified: 05SEP2026
font: JetBrains Mono
view: "40,199.68,1"
elements:
  - id: t1
    type: text
    x: 60
    y: 40
    w: 620
    h: 412
---

<!--@t1-->
# Architecture

The risk register lives here. No budget discussion on this page.

- Storage is plain Markdown on disk
- The server is Python standard library only
- Rendering is vanilla ES modules, no build step
- Fonts ship with the app: Roboto, JetBrains Mono, Calibri, Arial, Helvetica

Merged cells and hidden rules are written as an HTML block, because a pipe table
cannot express them: inffsn fsfd

<table data-borders="off">
<tbody><tr><th colspan="2">Storage</th></tr><tr><td>prose</td><td>Markdown body</td></tr><tr><td>geometry</td><td>YAML frontmatter</td></tr></tbody>
</table>

---
title: updates
created: 03SEP2026
modified: 04SEP2026
font: Roboto
view: "129.12,368.4,1"
elements:
  - id: release_review
    type: text
    x: -110.69
    y: -349.66
    w: 920
    h: 9507
---

<!--@release_review-->
# Final release review — 04SEP2026

This project is for personal use only and will run only on this Mac. Prioritize
reliable saving, intact notes and images, predictable editing, and simple
maintenance. The dependency-free Python server and local Markdown architecture
are appropriate; this review does not call for a broad rewrite or production
hosting infrastructure.

Status: review recorded; no fixes implemented by this review. Work through the
tasks below when authorized. Check off an item only after its acceptance checks
pass, and record the implementation and verification beneath it.

## Review baseline and working context

- Reviewed the current working tree in /Users/home/code/paper, including its existing uncommitted changes. Do not discard or overwrite those changes.
- The current front end is app/js/app.js, organized into scoped M\_\* sections. Older individual JavaScript files are deleted in the working tree; use the current file.
- Server: server.py. Launcher: ./paper. Normal URL: http://127.0.0.1:8420. Existing browser suite: /test.html.
- Existing suite result: 81 passed, 0 failed. Python source compilation and git diff --check passed. The application shell opened without captured console errors.
- Additional checks ran against a temporary copy with disposable notes, served on port 18420. That server was stopped. Temporary harnesses were not added to the repository and should not be assumed available later.
- Browser harnesses used copies of the real format, store, and table modules. Store timing tests substituted controlled API promises to reproduce response ordering. Backend reproductions called the real Handler methods with temporary filesystem roots.
- Findings marked reproduced below have direct test evidence. The full combined UI workflow for every lifecycle variant was not exercised; distinguish the confirmed backend sequence from the related consequences inferred from the callers.
- Line numbers below refer to the review baseline and will drift. Locate functions by name before editing.
- Use a disposable notebook for mutation tests. Browser editing, opening, autosaving, and history logging can write files. Do not test destructive scenarios against personal notes.

## Priority and execution order

P1: fix before final release because of content loss, misplaced content, or a
page freeze. P2: fix next for reliable persistence and predictable behavior. P3:
maintenance and broader regression coverage.

Ranked findings: 1–6 are P1; 7–10 are P2. Follow-up 11 is P2 durability work;
follow-up 12 is P3 coverage work. Consolidating redundant lifecycle logic is
part of finding 2, not a separate competing implementation.

Suggested order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12. Add a focused regression
with each fix rather than postponing all testing to item 12. Coordinate image
ownership and history changes in items 4 and 7.

## 1. P1 — Edits can be lost while saving

Status: \[x\] Fixed 04SEP2026. Reproduced with controlled API response timing.

Location: app/js/app.js, M\_store.saveNow() around line 1440; also touch(),
autosave, and open().

Cause: saveNow() serializes the document before awaiting api.write(), but after
the response it unconditionally clears store.dirty and computes savedContentKey
from the then-current document. New edits made while that write is in flight are
therefore incorrectly marked saved. The saved text and saved content fingerprint
can describe different revisions.

Reproduction: open A; make a first edit; start a save and hold its response;
make a second edit; complete the first save; switch to B before the next
debounce fires. The observed dirty flag was false and A on disk contained only
the first edit. Opening B skips saving A and the later autosave operates on the
active document.

Implementation direction: capture note identity, serialized text, and content
revision/fingerprint when starting a write. Apply completion bookkeeping only to
the appropriate note and revision. Serialize or coalesce overlapping saves so an
older write cannot win over a newer one. Keep later edits dirty and ensure they
are subsequently persisted. Make open() wait for the appropriate pending save
work.

Acceptance checks:

- Edits made during a delayed save remain dirty until their own successful write.
- Switching notes immediately after the first response preserves the second edit.
- Overlapping save requests and out-of-order responses cannot regress disk content or update another note's save metadata.
- A failed save retains unsaved edits and prevents a navigation path from silently discarding them.
- View-only persistence still avoids bumping the modified date.

Implemented 04SEP2026 in app/js/app.js M\_store: saveNow(), the new write(),
booked(), settleSaves(), touch(), touchView() and open().

Writes are now queued behind one another, so two responses cannot settle out of
order. Each write remembers the note it left with, the text it sent, the content
fingerprint of that text, and an edit counter; on completion it books only that
pair — a different note is left alone, and an edit made mid-flight leaves the
note dirty and re-arms the autosave that carries it. open() now calls
settleSaves(), which drains the queue and rejects if a save failed, so go()
toasts the error and the note with the unsaved work stays open. Panning still
bumps the edit counter without bumping `modified`, because the content
fingerprint continues to exclude the view.

Verified 04SEP2026:

- Fifteen store regressions added to app/test.html under "Saving", driven through the real store with stub API responses that can be held open. Whole suite: 96 passed, 0 failed (was 81 passed). Against the pre-fix store, five of the new assertions fail — including the review's reproduction: the edit typed during the write was booked as saved and switching notes wrote "one" to disk instead of "two".
- End-to-end against the real server on a disposable notebook (port 18420): create a note, edit, hold a save open, edit again mid-flight, save — disk ends with the newer text only, and the note stays dirty until its own write lands. That harness was not added to the repository.
- The app shell loaded with no JavaScript console errors and opened its note; python3 -m py\_compile server.py and git diff --check both pass.

Limitations: the 'A late write cannot book another note' guard is proven by the
white-box test that moves store.path mid-write, since open() now settles saves
first and no UI path reaches that ordering. The watcher's external-change reload
still replaces document state after an await without an identity guard; that is
item 8. Lifecycle operations that mutate the filesystem before settling saves
are item 2, and are untouched here.

## 2. P1 — File lifecycle operations race pending edits

Status: \[x\] Fixed 04SEP2026. Rename-then-save reproduced through the real UI
before the fix, and through the store's own stubs; fixed and re-verified.

Locations: app/js/app.js M\_tree.moveNote() around 3465, rename() around 3532,
history() around 3564, trash() around 3581, M\_store.open() around 1211, and the
note-title blur handler around 4539. Server mutations are in
Handler.api\_post().

Cause: sidebar rename/move/delete/restore acts on disk before settling the
active document's pending edits. Subsequent onOpen()/open() may save the old
store.path. The header rename already attempts saveNow() first, illustrating
inconsistent duplicated lifecycle handling.

Reproduction: create D.md with saved content; rename D.md to E.md through the
real backend; write pending content to the old D.md endpoint. Both files exist
afterward: E has the older saved content and D has the pending content. The
sidebar callers can produce this order because open() saves dirty state after
the rename.

Related consequences to verify: dirty note or folder deletion can recreate the
original path; restoring a version can be immediately overwritten by the dirty
editor when the note is reopened. Deleting the last note can leave the removed
document active. Renames also need to settle or rekey pending action-log writes
and parked undo histories.

Implementation direction: create one shared lifecycle flow used by title rename,
sidebar rename, drag move, trash, and restore. Settle relevant saves/actions
before filesystem mutation; update or clear active identity and dependent caches
afterward; load the intended result without writing stale state back. Handle
active notes inside renamed/deleted folders. Preserve the existing recovery
behavior of trash and version history.

Acceptance checks:

- Rename or move a dirty active note: one destination file contains the latest content and the old file does not reappear.
- Rename its parent folder with the same guarantees.
- Trash a dirty active note or folder: it stays trashed; pending saves cannot recreate it.
- Trash the last note: no editable deleted document remains active.
- Restore with pending edits: the chosen version remains current and pre-restore work is recoverable.
- Title rename and sidebar rename follow the same save and identity rules.
- Undo/action history follows the new path without recreating history under the old one.

Implemented 04SEP2026 in app/js/app.js: a new "the file underneath" section of
M\_store — settle(), moveFile(), trashFile(), restoreFile() and close() — with
M\_tree.moveNote(), rename(), trash() and the version-history menu, and the
note-title blur handler in M\_main, all rewritten to go through it. No module
outside M\_store calls api.rename, api.remove or api.restore any more.

Every one of them now takes the same three steps: settle what the open note owes
the disk — its text and its action log — then mutate the file, then put the
store's identity back in step. moveFile() carries the open document, the undo
stacks parked under the old path and any unwritten action log onto the new name,
and marks the document stale: the server rewrites a renamed note's title and
image references, so nothing may be written back until it has been read again.
trashFile() writes the pending work into the note before it goes to .trash — so
the copy sitting there is the whole of it — and then closes the store: no path,
a blank document, no armed autosave, and the parked history and queued log for
that path dropped, so nothing can recreate the file. restoreFile() settles
first, which is what puts the work being stepped away from inside the server's
forced pre-restore snapshot. touch() no longer marks the store dirty when
nothing is open, and with nothing open the shell carries a `no-note` class whose
canvas cannot be typed into.

Verified 04SEP2026:

- Twenty-two lifecycle regressions added to app/test.html under "File lifecycle", driven through the real store against stub endpoints with a disk model that can be renamed, trashed and restored. Whole suite: 118 passed, 0 failed (was 96). Move the settle back to after the mutation — the pre-fix ordering — and twelve of them fail, including the old name reappearing, the trashed note being recreated by a pending save, and the restored version being overwritten by the editor.
- A temporary same-origin harness drove the real app in a real browser against a disposable notebook on port 18420: rename a dirty note from the sidebar, then trash every note down to the last. Thirteen checks pass, with no console errors. Against the pre-fix ordering five fail and the renamed-away file comes back on disk carrying the pending edit, which is the review's reproduction seen through the UI.
- A second temporary harness ran the store's lifecycle calls against the real backend — create, rename, trash, restore, version history: sixteen checks pass, including that the note reopens with the server's rewritten title and that the pre-restore work is recoverable from history afterwards. Neither harness was added to the repository.
- Acceptance checks, one by one: dirty rename and dirty move, dirty parent-folder rename, dirty trash, trashing the last note, restore with pending edits, and undo/action history following the new path all have regressions in app/test.html; the dirty sidebar rename and the last-note case were additionally driven through the real UI, and rename, trash and restore through the real backend. Title rename and sidebar rename are the same call now.
- python3 -m py\_compile server.py and git diff --check pass. server.py is untouched by this item.

Limitations: the window between the mutation and the reopen is narrow but not
zero — an edit typed while the rename request is in flight is kept out of the
file by the stale flag and survives only in the undo history, not on disk.
Trashing a *folder* whose note is open is covered by the store regression's path
matching, not by a real folder on disk. Renaming still guesses image ownership
by filename prefix in the backend (item 4) and still leaves history snapshots
pointing at the old image names (item 7); an older navigation response can still
replace a newer selection (item 8); server-side writes remain non-atomic (item
11).

## 3. P1 — Leading pipe can freeze Markdown parsing

Status: \[x\] Fixed 04SEP2026. Reproduced in a worker that required termination
after 500 ms.

Location: app/js/app.js M\_format.mdToHtml() around line 349, especially the
table branch and paragraph loop.

Cause: a line starting with | that does not meet the table-header condition is
rejected by the paragraph loop as well. The outer loop then repeats without
advancing i.

Reproduction: mdToHtml('| ordinary text'). A normal paragraph beginning with a
pipe, or an incomplete hand-edited table, can reach this path when a note opens.
Also check whether HTML-to-Markdown can generate the same input from typed
prose.

Implementation direction: guarantee that every parsing iteration consumes input
or returns. Treat a leading pipe as ordinary prose unless it is part of a
recognized table. Do not simply discard the line to break the loop.

Acceptance checks:

- A bare pipe, pipe-prefixed prose, and incomplete tables return promptly and retain their text.
- Valid pipe tables and escaped literal pipes still parse correctly.
- Round-trip text beginning with a pipe through serializeNote()/parseNote().
- Use a timeout-isolated test so a regression cannot hang the entire suite.

Implemented 04SEP2026 in app/js/app.js M\_format: the new isTableStart() helper
and mdToHtml()'s table branch and paragraph loop.

A table is now recognised only where a pipe row and its dashed divider sit
together, and that single test is used in both places. The paragraph loop used
to refuse every line starting with a pipe, so a pipe line the table branch had
already turned down was left for nobody to consume and the outer loop spun on
it; it now stops only at a real table start, and takes such a line as the prose
it is. As a backstop the loop records the line it began at and consumes one line
if nothing else did, so no future branch can leave an iteration without
progress. Escaped pipes are untouched — inlineToHtml() parks them before any
emphasis rule runs — and a line beginning with a pipe still ends the paragraph
above it when a genuine table follows.

HTML-to-Markdown can indeed produce this input: neither escText() nor escStart()
escapes a leading pipe, so prose typed as "| ordinary text" is written to the
file verbatim and read back through exactly the path that used to hang.

Verified 04SEP2026:

- Nine regressions added to app/test.html under "Pipe-prefixed prose": a bare pipe, pipe-prefixed prose with and without a following space, an incomplete two-row table, a lone header row, an escaped literal pipe, prose immediately followed by a real table, and a round trip of pipe-prefixed prose through both trip() and serializeNote()/parseNote(). Whole suite: 127 passed, 0 failed.
- The seven parsing cases run inside a worker that is handed app.js as text and terminated if it has not answered in three seconds, so the deadline is enforced off the page's thread. The main-thread round-trip assertions run only after that worker has answered.
- Against the pre-fix parser the suite reports 118 passed, 1 failed: "mdToHtml answers on pipe-prefixed lines — timed out after 3s". The other 118 assertions still ran and reported, which is the isolation working.
- Checks ran headlessly against a temporary copy with disposable notes on port 18420. That server was stopped and the copy deleted; the harness that reported results back was not added to the repository.
- python3 -m py\_compile server.py and git diff --check both pass.

Limitations: mdToHtml() still has no thematic-break rule, so a line of three
dashes reads as a paragraph exactly as it did before. Code-block round-tripping
is item 10 and is untouched here.

## 4. P1 — Note rename can take another note's images

Status: \[x\] Fixed 04SEP2026. Reproduced against a disposable notebook through
the real backend, then fixed and re-verified.

Location: server.py Handler.move\_images() around line 734; coordinate with
rewrite\_renamed\_note() and /api/image naming.

Cause: old.glob(f'{src.stem}\[0-9\]\*') guesses image ownership from an
ambiguous filename prefix. A11.png can be the eleventh image of A.md or the
first image of A1.md. Glob metacharacters in note names and existing destination
image filenames also need consideration.

Reproduction: A.md references images/A1.png; A1.md uses images/A11.png. Rename A
to B. The backend moves both images to B1.png and B11.png, breaking A1's
reference.

Implementation direction: identify images from actual note references and define
how shared references are handled before moving a file. Prevent destination
collisions from overwriting images. A stable asset identity scheme may simplify
this, but preserve existing notes and their supported path behavior; coordinate
with item 7 rather than independently redesigning assets twice.

Acceptance checks:

- Renaming A does not move or rename an image owned by A1.
- Renaming notes with glob characters is safe.
- Moving between folders preserves every image and handles destination filename collisions without overwriting bytes.
- Explicitly shared image references remain valid.
- Existing notes continue to load and image path labels resolve correctly.

Implemented 04SEP2026 in server.py: Handler.move\_images() rewritten, the new
image\_refs(), renamed\_image() and apply\_image\_renames() helpers beside
rewrite\_renamed\_note(), which now takes the renames instead of guessing them.

Ownership is read off the note itself. move\_images() lists what is actually in
the old images folder and keeps the entries the note refers to as
`src: images/x`, `src="images/x"` or `](images/x)`, matching whole filenames
longest-first — so `images/A11.png` is read as A11.png and never as A1.png with
a stray digit after it, and A11.png stays with A1.md when A.md becomes B.md.
Nothing globs a note's name any more, which is what makes `Q[0-9]* (a+b).md`
safe; prose that merely mentions a path is not a reference, which matters
because this very note names images/A1.png in a sentence. Before moving anything
the function reads the other notes left in the old folder: an image one of them
still references is copied rather than taken away, so both notes keep a picture.
Every destination name goes through unique(), so an image already sitting in the
target folder is never written over — the arriving one lands as `N1 (2).png`.
Only files named `.ext` are renamed to follow the note; anything else keeps the
name it has. move\_images() returns {old name: new name} and
rewrite\_renamed\_note() rewrites exactly those references, in the body as well
as the frontmatter, rather than substituting a stem prefix on faith. Images the
note no longer references stay where they are.

Verified 04SEP2026:

- Seven backend regressions added as test\_server.py, checked in and documented in README: it starts the real handler on an ephemeral port over a throwaway notebook in a temporary directory and drives it through the API. `python3 test1server.py` reports Ran 7 tests, OK. Against the old prefix-glob ownership four of the seven fail, including A1.md's image being renamed out from under it and another note's image being overwritten in a folder move.
- A wider temporary harness — 40 checks over the same eight scenarios plus a copy of the real notebook, run against a real server on port 18420 — passes 40, 0 failed. Against the pre-fix backend it reports 27 passed, 13 failed, and reproduces the review's case exactly: renaming A.md moves A11.png to B11.png and breaks A1.md. That server was stopped, the copy deleted, and the harness was not added to the repository.
- Acceptance checks, one by one: renaming A leaves A11.png alone; a note named `Q[0-9]* (a+b).md` renames safely, as does renaming into `R*x?.md`; a folder move carries the note's image, keeps its bytes, and takes a free name when the destination already holds that filename; an image two notes reference stays valid for both. The copied real notebook still lists and opens Welcome.md, Kickoff.md and updates.md, and /api/image-path still resolves a label.
- app/test.html in a real browser: 127 passed, 0 failed, unchanged by this item — nothing in the front end was touched. (Headless Chrome reports 118 passed, 1 failed there: under its virtual clock the worker-isolated pipe test's three-second bell rings before the worker can start. The same seven cases run on the page's own thread in 1 ms with the expected output.)
- python3 -m py\_compile server.py and git diff --check pass.

Limitations: a snapshot taken before a rename still refers to the old image
names, so restoring one can leave a reference pointing at a moved file — that is
item 7, and this fix deliberately leaves the naming scheme in place for it to
build on. An image left unreferenced stays in the old folder rather than
following its note. Notes referencing an image through a path with `..` or a
subfolder are outside what move\_images() considers, as before.

## 5. P1 — Merged-table operations corrupt spans or delete text

Status: \[x\] Fixed 04SEP2026. Both examples reproduced through the real
M\_table helpers, then fixed and re-verified through the app's own context
menu.

Locations: app/js/app.js M\_table.insertRow() around 735, insertColumn(), and
deleteColumn() around 805.

Cause: the logical grid contains the same cell in multiple slots. Mutation loops
adjust that same DOM cell repeatedly without deduplicating it. In
deleteColumn(), an initial colspan decrement can cause a later visit to classify
the cell for removal.

Reproduction fixture: a two-row table whose first cell has rowspan=2 and
colspan=2 and contains 'merged'; the rightmost cells contain A and B. Insert a
row below A: the merged cell's rowspan becomes 4 instead of 3. In a fresh
fixture, delete one of its two merged columns: the 'merged' text disappears and
only A/B remain.

Implementation direction: process each spanning cell once per operation using a
set or the cell's origin in the pre-mutation grid. Audit symmetric row/column
operations and preserve rectangular grid coverage. Do not recalculate operation
decisions from spans already modified in the same loop.

Acceptance checks:

- The insertion example changes rowspan from 2 to 3 exactly.
- Deleting one of the merged cell's two columns retains its text, rowspan, and remaining colspan of 1.
- Symmetric column insertion and row deletion work with combined spans.
- Undo/redo restores content and geometry, and save/reopen preserves the result.

Implemented 04SEP2026 in app/js/app.js M\_table: insertRow(), insertColumn() and
deleteColumn().

Each mutation loop now walks grid slots but acts on cells. insertRow() and
insertColumn() keep a set of the cells they have already stretched, so a merged
cell standing in four slots of the seam grows by one, not by four — the review's
rowspan 2 becomes 3. deleteColumn() decides from the span the cell arrived with:
one visit per cell, recorded in a `seen` set, so the colspan decrement of the
first row can no longer be re-read as "this cell is one column wide, delete it"
in the second. The 'merged' text stays.

Two coverage bugs beside them, found while auditing the symmetric operations.
insertColumn() used to skip any row it reached through a rowspan, leaving the
new column with no cell in that row and the grid ragged; every row that does not
have the seam covered by a growing cell now gets one, placed before the first
cell that row starts itself at or after the seam, because a row only holds the
cells that begin in it. deleteColumn() removed a row emptied by the deletion but
left the cells reaching down into it claiming a row that was gone; those spans
now shrink to match.

Verified 04SEP2026:

- Twenty-one table regressions added to app/test.html under "Merged table editing", driven through the real M\_table helpers over the review's fixture. Whole suite: 148 passed, 0 failed (was 127). Against the pre-fix helpers eleven of them fail, including both reproductions: the rowspan reaching 4 and the 'merged' cell vanishing.
- End-to-end in the real app on a disposable notebook (port 18420), driven through Chrome's debugging protocol: seed the fixture, right-click A and choose Insert row below — the merged cell reads 3x2, ⌘Z restores 2x2, ⇧⌘Z returns 3x2 — then Delete column on the merged cell, which keeps its text at 3x1. Saving and reloading the page reopens exactly that table. Tabbing off the last cell, the other route into insertRow(), adds its row without touching the merge. The server was stopped and neither the copy nor the harness was added to the repository.
- python3 test\_server.py reports Ran 7 tests, OK; python3 -m py\_compile server.py and git diff --check pass. Nothing outside M\_table was touched, apart from app/test.html and M\_table being added to the \_\_test export so the suite can call it.

Limitations: deleting a column that empties a row still removes that row, which
is the behaviour the module already had — the fix makes the surviving spans
honest about it rather than changing the choice. Headless Chrome's
--virtual-time-budget still fails the worker-isolated pipe test from item 3 by
ringing its three-second bell before the worker starts; the suite was therefore
run over the debugging protocol on the real clock, where it passes.

## 6. P1 — Markdown with ordinary frontmatter loses its body

Status: \[x\] Fixed 04SEP2026. Reproduced directly through parseNote(), then
fixed and re-verified against the real backend.

Location: app/js/app.js M\_format.parseNote() around line 280.

Cause: any recognized frontmatter sends the file through Paper's element/block
parser. When there are no valid elements, it inserts a blank element instead of
adopting the body. Unrecognized metadata is also not retained by the current
model; decide preservation behavior deliberately while fixing the body loss.

Reproduction: a file with opening ---, title: Imported, closing ---, and the
body 'Important prose'. parseNote() returns an element with

\

. A subsequent save can replace the original prose with blank content.

Implementation direction: distinguish Paper element metadata from ordinary
Markdown frontmatter. If usable Paper elements are absent, create a default text
element containing the existing body. Consider orphaned/unmarked body text and
malformed element definitions so the fix does not silently drop other imported
content.

Acceptance checks:

- Markdown with ordinary title/tags frontmatter retains its prose through open, edit, save, and reopen.
- Existing valid Paper files preserve layout and text.
- Empty or invalid elements do not silently erase a nonempty body.
- Establish and document a deliberate policy for unfamiliar frontmatter fields.

Implemented 04SEP2026 in app/js/app.js M\_format: the new foreignLines() and
adopted() helpers, a rewritten splitBlocks(), and parseNote()/serializeNote().

parseNote() no longer assumes that recognized frontmatter means Paper wrote the
file. splitBlocks() now returns the body's chunks in file order, with a null id
for text that arrives before the first marker, and parseNote() records which
ids a text or box element actually claimed. Whatever is left over — the whole
body of an imported file, prose above the first marker, or the block of an
element definition that was dropped for being malformed — is adopted: it
becomes the sole text element when no element survived, or an extra text
element parked below the others when some did. Nothing that had content on disk
is written back blank.

Policy for unfamiliar frontmatter: Paper owns title, created, modified, font,
view and elements. Every other top-level key is left uninterpreted but kept
verbatim — parseNote() carries its raw source lines on meta.extra and
serializeNote() writes them back, in their original order, between the fields
Paper owns and elements:. So a tags: list or an aliases: block from another
tool survives editing and saving here, and Paper never has to guess what a
field it does not understand was supposed to mean. This is documented under
"Imported files" in README.md.

Verified 04SEP2026:

- Seventeen format regressions added to app/test.html under "Imported Markdown", covering the review's reproduction, foreign frontmatter round-tripping, a malformed element definition, stray prose above a marker and its placement, a block with no matching element, an empty body, and a well-formed note being left exactly as it was. Whole suite: 156 passed, 1 failed — the one failure is the headless artifact described under Limitations, not a regression. The same suite run against the pre-fix parser reports 146 passed, 11 failed: ten of the seventeen new assertions fail there — the imported prose came back as a blank element, the malformed definition's heading was gone, and the stray prose above a marker was never adopted. Two of the new tests also index elements defensively, so a future regression fails those assertions instead of throwing and halting the suite.
- End to end against the real server on a disposable notebook (port 18420): a file with title/tags/aliases frontmatter and the body "Important prose" was read through /api/note, opened with parseNote(), edited, saved with a real PUT and read back. Disk ends with the prose plus the new paragraph, elements: added, and the tags: line and aliases: block intact in their original order. That harness was not added to the repository.
- The app shell loaded with no console errors; python3 -m py\_compile server.py and git diff --check pass. server.py needed no change: split\_note() already ignores keys it does not know.

Limitations: the suite's one failure is the pipe-prose worker test from item 3,
which times out under headless Chrome's virtual clock because the worker is not
advanced with the page. Running those same inputs through mdToHtml() on the
main thread in the same headless browser returns immediately, so item 3 stands;
the test passes in a real browser. Unfamiliar frontmatter is preserved but not
editable in the app, and a foreign key written between Paper's own fields is
re-emitted after them rather than exactly where it stood. Item 7's history and
image work is untouched here.

## 7. P2 — History restoration after rename breaks image references

Status: \[x\] Fixed 04SEP2026. Reproduced against the real backend and through
the real store, then fixed and re-verified.

Locations: server.py rewrite\_renamed\_note() around 125, rename/move history
transfer around 638, restore copy around 677; app/js/app.js M\_store action
snapshots and revertTo().

Cause: rename updates current image filenames and current note references, then
moves history unchanged. Saved versions and action snapshots still contain the
old image paths and titles. Restoring those states can point to files that no
longer exist.

Reproduction: snapshot B.md while it references images/B1.png; rename B.md to
C.md; restore the carried snapshot. C.md once again references images/B1.png,
but the image now exists as C1.png.

Implementation direction: coordinate with item 4. Prefer a coherent asset
identity strategy, or safely migrate historical references as part of rename.
Cover both Markdown version snapshots and JSON action snapshots, including undo
stacks retained in memory. Avoid changing unrelated prose that happens to
contain a similar name.

Acceptance checks:

- Restore a pre-rename version and a pre-rename action step: images still display.
- Move to another folder and restore: relative paths remain valid.
- Repeated renames, destination-name collisions, and undo/redo do not break asset references.
- Pre-restore state remains recoverable.

Implemented 04SEP2026. Item 4 already worked out which images a rename moves and
what it renamed them to; this carries that answer through to everything that
remembers what the note used to say, rather than redesigning asset naming a
second time.

server.py: `move_images()` returns {old name: new name}, and the rename handler
now keeps that map and passes it on. The title rewrite has been lifted out of
`rewrite_renamed_note()` into `retitled()`, so a stored version can be brought
forward exactly the way the live note is. The new `migrate_history()` runs after
`move_history()`, over the history folder that has just followed the note: every
kept `.md` version is retitled and its image references rewritten with
`apply_image_renames()`, and `migrate_actions()` does the same for the action
log's snapshots. Those are whole documents stored as JSON, so they are parsed
and walked (`retarget_snap()`) rather than string-substituted — inside JSON the
quotes of `src="images/x"` are escaped, and text substitution would miss them —
and each document's `meta.title` is set to the new stem. A version is written
back only if it changed, and its mtime is restored afterwards with `os.utime()`:
`versions_of()` orders the History page by when a snapshot was taken, so
restamping the files would have shuffled it.

app/js/app.js: `/api/rename` now answers with `images` and `title` as well as
`path`, and `moveFile()` uses them to bring the undo stacks held in memory
forward the same way — the live `store.history`, the stack parked under the old
path, `store.actions`, and any action log still queued for writing. `retarget()`
mirrors the server's reference rule (`src: images/x`, `src="images/x"`,
`](images/x)`, longest filename first); `moved()` parses a snapshot, walks it,
and retitles it. `title` is sent only when the thing that moved was a note, so a
folder rename — where the notes inside keep their names and their references —
carries nothing.

Verified 04SEP2026:

- Six backend regressions added to test_server.py, which now reports Ran 13
  tests, OK: a version and an action step saved before a rename both point at
  the moved image and carry the new title; a move whose destination already
  holds that filename ends up on the free name it actually took; repeated
  renames stay in step; rewriting versions does not reorder the History page
  (their mtimes are deliberately set out of step with their filenames first);
  and a folder rename leaves its notes' history alone. Against the pre-fix
  server.py five of the six fail and the folder control passes.
- Five checks added to app/test.html's store section, which reports 161 passed,
  1 failed in headless Chrome — the failure is the known worker-under-virtual-
  clock timeout from item 4, unrelated and present before this change. Against
  the pre-fix app.js four of the five new checks fail; the fifth (prose naming a
  path is left alone) passes either way, as it should.
- A copy of the real notebook, served on port 18420: updates.md has 22 kept
  versions, five of which reference images/updates1.png although the current
  note does not. Renaming it to `release notes.md` left the version order
  unchanged, retitled every version, and left those five pointing at
  images/updates1.png — which is right, because an image the note no longer
  references is not moved. /api/image-path resolves it, restoring one of those
  versions brings the picture back, and the tree still lists and opens the rest
  of the notebook. That server was stopped and the copy deleted.
- python3 -m py\_compile server.py and git diff --check pass.

Limitations: history is migrated with the renames the current note produced, so
an image only an old version referenced stays where it is under its old name —
still valid, because nothing moved it, but it will not follow the note. A note
whose images live through a `..` or subfolder path is outside what
`move_images()` sees, as before. Notes trashed and restored by hand are not
migrated; only rename and move are.

## 8. P2 — Older navigation response can replace the latest selection

Status: \[x\] Fixed 04SEP2026. Reproduced with controlled read promises, then
fixed and re-verified.

Location: app/js/app.js M\_store.open() around line 1211; main go() and
external-change reloads need compatible identity guards.

Cause: open() applies each api.read() result without checking whether a later
navigation superseded it. The tree can also be updated by the older go()
completion.

Reproduction: request A, then B; resolve B first, then A. Final store.path is
A.md even though B was the latest request.

Implementation direction: use a navigation generation/token and apply only the
current request's result. Keep sidebar selection, header, document, actions, and
save metadata consistent. Coordinate with item 1 so cancellation does not skip
required saves. Inspect the watcher, which also awaits a read before replacing
shared document state.

Acceptance checks:

- A then B clicks with reversed read completion leave B active everywhere.
- A stale read or stale error cannot replace a newer successful navigation.
- A delayed external-change read cannot replace a different note opened meanwhile.
- Dirty-note navigation still preserves pending edits.

Implemented 04SEP2026 in app/js/app.js M\_store.open(), loadActions(), the new
reloadChanged(), startWatching(), and M\_main.go().

Every open request now receives an increasing navigation token. It checks that
token after settling the current note, after its read returns, and again after a
second settlement immediately before applying the result. That last settlement
matters because the old document remains editable while the destination read is
away: an edit made in that interval is written before the document can be
replaced. An older success returns false without changing the store; an older
failure does the same, leaving only the current request able to show an error.
loadActions() carries the same token, so an A → B → A sequence cannot merge the
first visit's delayed action log into the second visit.

go() changes the sidebar and refreshes links only when open() reports that its
request actually won, and points the tree at store.path rather than at a stale
caller's argument. The header, document, undo history, actions, save metadata,
and remembered last page are all changed inside the same guarded open commit.

The watcher now delegates to reloadChanged(). Before reading it captures the
navigation token, path, mtime and saved text; after the await it also requires
the note still to be clean and every captured value still to match. A response
from an earlier visit, or from before a local save, is therefore harmless even
when its path happens to match again.

Verified 04SEP2026:

- Fifteen deterministic regressions added to app/test.html under "Navigation
  ordering", with api.read promises resolved and rejected in controlled order.
  They cover reversed A/B completion, a stale error after a newer success, a
  watcher response after navigating away, document/save metadata/localStorage
  consistency, delayed action logs, and an edit typed while the destination was
  loading. The full suite in Chrome reports 185 passed, 0 failed.
- The existing dirty-note switch test still proves work pending before a click
  reaches disk, while the new mid-read test proves work typed after the click
  reaches disk before the requested page replaces it.
- python3 test\_server.py reports Ran 13 tests, OK; python3 -m py\_compile
  server.py and git diff --check pass. No backend behavior changed for this item.

Limitation: superseded network reads are not aborted; they are allowed to finish
and their results are discarded. This avoids coupling the store to a particular
request implementation and keeps cancellation from interfering with required
saves.

## 9. P2 — Headerless tables regain a header after reopening

Status: \[x\] Fixed 04SEP2026. Reproduced through
HTML-to-Markdown-to-HTML conversion, then fixed and re-verified.

Locations: app/js/app.js M\_format.isComplexTable() around 566 and tableToMd()
around 609.

Cause: a plain table containing only td cells is written as a pipe table.
readTable() always interprets its first row as th cells. Header absence is
meaningful structure that the current complexity check omits.

Reproduction: round-trip a two-row, two-column td-only table. The first row
returns inside thead with th cells. This affects the UI's Header off setting.
The existing 'pipe in table' test actually expects this conversion and will need
its expectation reconsidered.

Implementation direction: write headerless tables as raw HTML, or introduce an
equally lossless supported representation. Preserve the existing compact pipe
representation for compatible header tables.

Acceptance checks:

- Header off survives save/reopen without other styling being required.
- Header on still round-trips and simple compatible tables remain pipe tables.
- Row content, formatting, and section structure are retained.

Implemented 04SEP2026 in app/js/app.js M\_format.isComplexTable(). The
serializer now treats a table whose first row begins with a `td` as structure
that pipe Markdown cannot represent. It writes that table through the existing
raw-HTML path, including its `thead`/`tbody` sections and cell HTML, instead of
inventing the pipe divider that made row one a header on the next read. Tables
whose first row is a real `th` header remain in the compact pipe format when
they carry no other complex state. README now lists a missing header among the
table states that require raw HTML.

Verified 04SEP2026:

- Six assertions were added to app/test.html and the old lossy expectation for
  a literal pipe inside a headerless cell was corrected. Together they cover
  raw-HTML selection, a two-row headerless round trip with bold and italic cell
  content, whole-note serialization, the real Header toggle remaining off
  after that file trip, and a compatible header table remaining a pipe table
  and round-tripping.
- The complete Chrome suite reports 191 passed, 0 failed, with no console
  warnings or errors.
- python3 test\_server.py reports Ran 13 tests, OK; python3 -m py\_compile
  server.py and git diff --check pass. No backend behavior changed for this
  item.

Limitation: headerless tables are deliberately more verbose on disk than simple
header tables because standard pipe-table syntax has no header-off form. They
remain readable, legal Markdown HTML blocks.

## 10. P2 — Code blocks do not round-trip

Status: \[x\] Fixed 04SEP2026. Reproduced through the real format helpers and
covered by focused round-trip regressions.

Locations: app/js/app.js M\_format.blocksToMd() around 518 (pre handling) and
mdToHtml() around 349.

Cause: the writer emits fenced code blocks for pre elements, but the reader has
no corresponding fenced-block branch. It treats fences and content as paragraph
text.

Reproduction: serialize

\`\`\` const x = 1; followed by a newline and const y = 2; \`\`\`

through htmlToMd(), then mdToHtml(). The result is one paragraph containing
literal triple backticks and collapsed code lines.

Implementation direction: add matching fenced-code parsing with escaped code
content and preserved whitespace. Consider language annotations, blank lines,
Markdown punctuation, and embedded backticks when choosing delimiters.

Acceptance checks:

- Multiline code, indentation, blank lines, and literal HTML characters survive round-trip.
- Markdown-looking content inside code is not interpreted as headings, lists, or tables.
- The writer and reader agree on fence delimiters and supported language metadata.

Implemented 04SEP2026 in app/js/app.js M\_format. mdToHtml() now recognizes
backtick and tilde fences before any other block syntax, escapes their contents
into `pre`, and carries a simple language info string as `language-*` on a
nested `code` element. Paragraph parsing also stops at a fence, so a code block
can interrupt prose without its opening marker being swallowed.

The writer now chooses a backtick fence longer than every backtick run in the
code. It no longer drops a trailing newline from `pre`, and its Markdown cleanup
skips fenced bodies, so indentation, trailing spaces and repeated blank lines
are not normalized away. The closing delimiter's required newline remains
syntax rather than becoming code; an intentional final newline is represented
by a blank code line before it.

Verified 04SEP2026:

- Eleven assertions were added to app/test.html for multiline code, indentation,
  blank lines, trailing spaces, literal HTML, Markdown-looking text, embedded
  triple backticks, tilde fences, language metadata and whole-note persistence.
- The complete Chrome suite reports 202 passed, 0 failed (was 191), with no
  console warnings or errors.
- python3 test\_server.py reports Ran 13 tests, OK; python3 -m py\_compile
  server.py test\_server.py and git diff --check pass. No backend behavior
  changed for this item.

Limitation: Paper preserves one simple language token made of letters, digits,
underscore, plus, dot or hyphen. More elaborate Markdown fence info strings are
accepted as code blocks but are not retained as editable HTML metadata.

## 11. P2 — Make persistent writes atomic

Status: \[x\] Fixed 04SEP2026. The review's interruption risk is now covered by
fault injection against the real note endpoint.

Locations: server.py /api/note around line 596, save\_meta(), write\_actions(),
rewrite\_renamed\_note(), and /api/restore.

Current risk: direct write\_bytes()/write\_text() truncates the destination
before completing its new contents. A process interruption or write failure can
leave a partial file. ThreadingHTTPServer can also execute overlapping
operations; atomic replacement alone does not solve stale write ordering or
metadata read-modify-write races.

Implementation direction: share a small helper that writes a temporary sibling
file and atomically replaces its destination on success. Preserve the original
on failure and clean up temporary files. Consider appropriate flush/fsync
behavior for this local app. Coordinate per-path mutation ordering with items 1
and 2; protect metadata updates if overlapping requests could lose another field
change.

Acceptance checks:

- A simulated failure before replacement leaves the previous file intact.
- Readers observe a complete old or complete new file.
- Snapshot behavior and restore recovery remain intact.
- Temporary files do not appear in navigation or accumulate after failures.
- Do not claim atomic replacement alone fixes concurrent update ordering.

Implemented 04SEP2026 in server.py: `atomic_replace()`,
`atomic_write_bytes()`, `atomic_write_text()`, `atomic_copyfile()`,
`update_meta()` and the persistent mutation routes.

Every file-content write now goes to a hidden temporary sibling first. Paper
flushes and fsyncs that complete file, calls `os.replace()` only after the write
succeeds, and best-effort fsyncs the parent directory. The old destination is
therefore untouched if writing or replacement fails, and the `finally` cleanup
removes the temporary file. Existing destination permissions are retained.
This path covers notes, created note templates, metadata, action logs, version
snapshots, restore copies, note/history rewrites after rename, image uploads and
copied shared images.

A process-wide reentrant mutation lock keeps compound note snapshot/write,
create, rename/move, delete and restore sequences from interleaving. Metadata
field changes use one locked read-modify-write through `update_meta()`, so a
simultaneous colour and emoji change cannot each save a stale copy of the
sidecar and erase the other field.

Verified 04SEP2026:

- Three backend regressions were added to test_server.py. A simulated
  `os.replace()` failure on the real `/api/note` endpoint returns 500 while the
  prior note remains byte-for-byte current and its hidden temporary sibling is
  removed. A held replacement exposes the complete old file until the instant
  the complete new one lands, with the temporary sibling absent from
  `build_tree()`. A controlled pair of metadata updates proves the second
  mutator cannot enter until the first has saved; both fields remain afterward.
- `python3 test_server.py` reports Ran 16 tests, OK. Its existing rename,
  snapshots and restore recovery checks all still pass, including the forced
  pre-restore version and restoring the selected historical contents.
- The complete isolated Chrome suite reports 202 passed, 0 failed, with no
  console warnings or errors. `python3 -m py_compile server.py test_server.py`
  and `git diff --check` pass.

Limitation: the lock serializes filesystem mutation inside this server process,
but it is not a document revision protocol. A separate client that deliberately
sends an older full-note body after a newer one can still make that later
request win. Paper's browser prevents its own stale save ordering with the
queued, revision-aware store work from item 1; atomic replacement itself is not
claimed to solve that problem. Parent-directory fsync is best effort because
some filesystems do not support it.

## 12. P3 — Expand regression coverage beyond format happy paths

Status: \[x\] Fixed 04SEP2026. Focused tests were added with items 1–11; the
integrated coverage and isolation audit is complete.

Review baseline: app/test.html was the only checked-in suite and passed all 81
assertions despite the reproduced defects. README described it as the only one
that mattered; that claim needed updating when coverage expanded.

Implementation direction: retain useful format round trips, then add
deterministic store timing tests, parser timeout protection, merged-table
behavior, and stdlib backend filesystem tests. Use temporary directories and
controlled promises rather than fragile sleeps. Keep the project dependency-free
unless a concrete need justifies a change. Small testable module exports or
isolated sections are preferable to a broad front-end rewrite solely for
testing.

Acceptance checks:

- Each reproduced defect above has a regression that fails before its fix and passes afterward.
- Tests never mutate personal notes, notebook metadata, or normal browser storage.
- Document simple commands/URLs and expected results in README.
- Run the full relevant suite once after integration and record the results here.

Implemented 04SEP2026 in app/test.html, app/js/app.js, test_server.py and
README.md.

The checked-in coverage now follows the defects rather than only the format's
happy path. Items 1, 2 and 8 use controlled promises around the real store to
hold writes, reads and lifecycle calls in the exact problematic order. Item 3
runs the shipped parser in a Web Worker with a three-second deadline. Items 5,
6, 9 and 10 drive the real table and format helpers through structural edits
and complete note-file round trips. Items 4, 7 and 11 run the real HTTP handler
against a new temporary notebook for every test, including image/history
migrations and fault-injected atomic replacements.

The browser store suite no longer touches the notebook origin's real
localStorage, even temporarily. M_store now has a narrow useStorage() test seam,
and app/test.html installs a fresh in-memory Storage-shaped object before its
first store operation. Its API endpoints remain controlled stubs and its fake
paths never reach a mutating server endpoint. The backend suite continues to
replace NOTES, META_FILE and HISTORY with paths under a temporary directory in
setUp(), then restores the globals and removes that directory in tearDown().

README now treats both checked-in suites as release checks, gives the browser
URL and backend command, states their expected results, and includes the source
compilation and whitespace checks.

Verified 04SEP2026:

- Browser at http://127.0.0.1:18420/test.html: 202 passed, 0 failed; tab title
  PASS 202; no console warnings or errors. The page imports the current
  app/js/app.js, and the local server was stopped after the run.
- `python3 -m unittest -v test_server.py`: all 16 tests passed, followed by OK.
  Every test used a throwaway notebook; personal notes and metadata were not
  opened or changed.
- `python3 -m py_compile server.py test_server.py` and `git diff --check` both
  completed with exit status 0.

Remaining limitation: app/test.html is intentionally a browser page rather
than a headless command, because its parser worker and DOM/table behavior rely
on browser APIs. The result is explicit in both the page heading and tab title.

## Completion notes

For each implemented item, record the date, changed functions/files, behavior
now guaranteed, tests run, and any remaining limitation. Keep this review's
reproduction context available until the final release checks are complete. Do
not mark code-inspected risks as experimentally reproduced without running their
checks.


## Follow-up fixes from implementation review — 04SEP2026

Implemented the four remaining findings in items 1, 2 and 7. This entry
supersedes those items' earlier limitations about edits during a rename and
images referenced only by historical versions.

- Save settling now drains until the document is clean instead of returning
  after three writes. Navigation preserves edits arriving during successive
  in-flight saves; failed writes still prevent navigation.
- Rename, move, trash and restore now lock input before settling pending work.
  Older navigation reads are invalidated, concurrent navigation/mutations are
  rejected, and the editor stays inert until a moved/restored note is reloaded.
  Failed mutations release the lock without changing the active note identity.
- Image retargeting now handles structured canvas `src` fields in both browser
  undo/action history and server action snapshots, as well as embedded HTML.
- Image ownership includes version snapshots and action history. Historical
  images follow a note across folders, destination collisions preserve both
  files, and another note's historical references keep a shared source copy.

Verification: 214 browser assertions passed with zero failures; all 28 isolated
backend tests passed. New regressions cover more than three dirty revisions,
input blocking and failed-rename recovery, canvas-image history, historical
image moves with destination collisions, and peer history retaining a shared
image. The real title-rename workflow was exercised on a disposable notebook.
Python compilation and git diff --check passed. Personal notes were not used
for mutation testing.

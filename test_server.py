#!/usr/bin/env python3
"""
Backend regressions for server.py - the half of the app app/test.html cannot see.

    python3 test_server.py

Every test runs the real handler over HTTP against a throwaway notebook in a
temporary directory. Your own notes are never opened.
"""

import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from unittest import mock

import server


def note(title, srcs=(), body=""):
    """A note file the way the browser writes one: images live in frontmatter."""
    els = "".join(f"  - id: i{n}\n    type: image\n    src: images/{s}\n"
                  for n, s in enumerate(srcs))
    return f"---\ntitle: {title}\nelements:\n{els}---\n\n{body}\n"


class Backend(unittest.TestCase):
    """A live server on a disposable notebook, driven through its own API."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="paper-test-"))
        self.notes = self.tmp / "notes"
        self.notes.mkdir()
        self.saved = {k: getattr(server, k)
                      for k in ("NOTES", "META_FILE", "HISTORY", "SNAPSHOT_EVERY")}
        server.NOTES = self.notes
        server.META_FILE = self.notes / ".paper.json"
        server.HISTORY = self.notes / ".history"
        server.Handler.log_message = lambda *a: None      # keep the test output clean
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for k, v in self.saved.items():
            setattr(server, k, v)
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- the API, as the browser calls it ---------------------------------
    def get(self, route, **params):
        url = self.base + route + "?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=10) as f:
            return json.loads(f.read())

    def post(self, path, data=None, raw=None):
        body = raw if raw is not None else json.dumps(data or {}).encode()
        req = urllib.request.Request(self.base + path, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=10) as f:
            return json.loads(f.read())

    def write(self, rel, text):
        self.post("/api/note?" + urllib.parse.urlencode({"path": rel}), raw=text.encode())

    def upload(self, rel, data=b"PNG"):
        q = urllib.parse.urlencode({"path": rel, "ext": "png"})
        return self.post("/api/image?" + q, raw=data)["name"]

    def rename(self, a, b):
        return self.post("/api/rename", {"from": a, "to": b})["path"]

    def text(self, rel):
        return (self.notes / rel).read_text("utf-8")

    def refs(self, rel):
        return [ln.split("images/", 1)[1].strip()
                for ln in self.text(rel).splitlines() if "src: images/" in ln]

    # -- item 11: every durable file replacement is all-or-nothing --------
    def test_failed_note_replace_keeps_the_previous_file_and_cleans_temp(self):
        self.write("Safe.md", note("Safe", body="old"))
        target = self.notes / "Safe.md"
        real_replace = server.os.replace

        def fail_target(src, dst):
            if Path(dst).resolve() == target.resolve():
                raise OSError("simulated interruption before replacement")
            return real_replace(src, dst)

        with mock.patch.object(server.os, "replace", side_effect=fail_target):
            with self.assertRaises(urllib.error.HTTPError) as stopped:
                self.write("Safe.md", note("Safe", body="new"))
        self.assertEqual(stopped.exception.code, 500)
        stopped.exception.close()
        self.assertIn("old", target.read_text("utf-8"))
        self.assertNotIn("new", target.read_text("utf-8"))
        self.assertEqual(list(self.notes.rglob(".Safe.md.*.tmp")), [])

    def test_readers_see_the_complete_old_or_complete_new_file(self):
        target = self.notes / "Whole.md"
        old, new = b"old:" + b"a" * 10000, b"new:" + b"b" * 10000
        target.write_bytes(old)
        replacing, release = Event(), Event()
        errors = []
        real_replace = server.os.replace

        def hold_replace(src, dst):
            replacing.set()
            if not release.wait(5):
                raise TimeoutError("test did not release replacement")
            return real_replace(src, dst)

        def write_new():
            try:
                server.atomic_write_bytes(target, new)
            except Exception as exc:                 # returned to the test thread
                errors.append(exc)

        with mock.patch.object(server.os, "replace", side_effect=hold_replace):
            writer = Thread(target=write_new)
            writer.start()
            self.assertTrue(replacing.wait(5))
            self.assertEqual(target.read_bytes(), old)
            temps = list(self.notes.glob(".Whole.md.*.tmp"))
            self.assertEqual(len(temps), 1)
            tree = server.build_tree(self.notes, {}, [0])
            self.assertEqual([item["name"] for item in tree["notes"]], ["Whole"])
            release.set()
            writer.join(5)
        self.assertFalse(writer.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(target.read_bytes(), new)
        self.assertEqual(list(self.notes.rglob(".Whole.md.*.tmp")), [])

    def test_metadata_read_modify_write_is_serialized(self):
        first_inside, release, second_inside = Event(), Event(), Event()
        errors = []

        def run(change):
            try:
                server.update_meta(change)
            except Exception as exc:
                errors.append(exc)

        def add_color(meta):
            meta.setdefault("colors", {})["Folder"] = "#123456"
            first_inside.set()
            if not release.wait(5):
                raise TimeoutError("test did not release metadata update")

        def add_emoji(meta):
            second_inside.set()
            meta.setdefault("emojis", {})["A.md"] = "🔥"

        first = Thread(target=run, args=(add_color,))
        second = Thread(target=run, args=(add_emoji,))
        first.start()
        self.assertTrue(first_inside.wait(5))
        second.start()
        try:
            self.assertFalse(second_inside.wait(0.1))
        finally:
            release.set()
        first.join(5)
        second.join(5)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(server.load_meta(), {
            "colors": {"Folder": "#123456"},
            "emojis": {"A.md": "🔥"},
        })

    # -- item 4: a rename must take its own images and only its own -------
    def test_prefix_named_image_stays_with_the_note_that_owns_it(self):
        """A11.png is A1.md's first image, not A.md's eleventh."""
        self.write("A.md", note("A"))
        self.write("A1.md", note("A1"))
        a1, a11 = self.upload("A.md"), self.upload("A1.md", b"OWNED")
        self.assertEqual((a1, a11), ("A1.png", "A11.png"))
        self.write("A.md", note("A", [a1]))
        self.write("A1.md", note("A1", [a11]))
        self.rename("A.md", "B.md")
        self.assertTrue((self.notes / "images" / "B1.png").is_file())
        self.assertEqual((self.notes / "images" / "A11.png").read_bytes(), b"OWNED")
        self.assertEqual(self.refs("A1.md"), ["A11.png"])
        self.assertEqual(self.refs("B.md"), ["B1.png"])
        self.assertIn('title: "B"', self.text("B.md"))

    def test_glob_characters_in_a_note_name_are_safe(self):
        odd = "Q[0-9]* (a+b).md"
        self.write(odd, note("Q"))
        img = self.upload(odd)
        self.write(odd, note("Q", [img]))
        self.write("Other.md", note("Other"))
        other = self.upload("Other.md", b"OTHER")
        self.write("Other.md", note("Other", [other]))
        self.rename(odd, "Plain.md")
        self.assertEqual(self.refs("Plain.md"), ["Plain1.png"])
        self.assertTrue((self.notes / "images" / "Plain1.png").is_file())
        self.assertFalse((self.notes / "images" / img).exists())
        self.assertEqual((self.notes / "images" / other).read_bytes(), b"OTHER")
        self.rename("Plain.md", "R*x?.md")          # and back out into one
        self.assertEqual(self.refs("R*x?.md"), ["R*x?1.png"])

    def test_moving_to_another_folder_keeps_every_image(self):
        self.post("/api/create", {"path": "Box", "kind": "folder"})
        self.write("Box/Keeper.md", note("Keeper"))
        (self.notes / "Box" / "images").mkdir(parents=True)
        (self.notes / "Box" / "images" / "K1.png").write_bytes(b"BOX")
        self.write("Box/Keeper.md", note("Keeper", ["K1.png"]))
        self.write("K.md", note("K"))
        mine = self.upload("K.md", b"MINE")         # images/K1.png, same name
        self.write("K.md", note("K", [mine]))
        self.rename("K.md", "Box/K.md")
        carried = self.refs("Box/K.md")
        self.assertEqual(len(carried), 1)
        self.assertNotEqual(carried[0], "K1.png")   # the taken name is not reused
        self.assertEqual((self.notes / "Box" / "images" / carried[0]).read_bytes(), b"MINE")
        self.assertEqual((self.notes / "Box" / "images" / "K1.png").read_bytes(), b"BOX")
        self.assertEqual(self.refs("Box/Keeper.md"), ["K1.png"])
        self.assertFalse((self.notes / "images" / "K1.png").exists())

    def test_a_shared_image_stays_valid_for_both_notes(self):
        self.write("S.md", note("S"))
        shared = self.upload("S.md", b"SHARED")
        self.write("S.md", note("S", [shared]))
        self.write("T.md", note("T", [shared]))     # T points at S's image
        self.rename("S.md", "U.md")
        self.assertEqual((self.notes / "images" / shared).read_bytes(), b"SHARED")
        self.assertEqual(self.refs("T.md"), [shared])
        carried = self.refs("U.md")
        self.assertEqual(len(carried), 1)
        self.assertEqual((self.notes / "images" / carried[0]).read_bytes(), b"SHARED")

    def test_prose_that_names_a_path_is_not_a_reference(self):
        self.write("Holder.md", note("Holder"))
        held = self.upload("Holder.md", b"HELD")
        self.write("Holder.md", note("Holder", [held]))
        self.write("P.md", note("P", [], f"P mentions images/{held} in prose only.\n"))
        self.rename("P.md", "P2.md")
        self.assertEqual((self.notes / "images" / held).read_bytes(), b"HELD")
        self.assertEqual(self.refs("Holder.md"), [held])

    def test_a_markdown_body_reference_follows_its_note(self):
        self.write("M.md", note("M"))
        img = self.upload("M.md")
        self.write("M.md", note("M", [], f"![shot](images/{img})\n"))
        self.rename("M.md", "MM.md")
        self.assertTrue((self.notes / "images" / "MM1.png").is_file())
        self.assertIn("images/MM1.png", self.text("MM.md"))

    def test_renaming_a_note_without_images_leaves_the_folder_alone(self):
        self.write("Plain.md", note("Plain"))
        self.write("Keeper.md", note("Keeper"))
        kept = self.upload("Keeper.md", b"KEPT")
        self.write("Keeper.md", note("Keeper", [kept]))
        self.rename("Plain.md", "Renamed.md")
        self.assertEqual((self.notes / "images" / kept).read_bytes(), b"KEPT")
        self.assertIn('title: "Renamed"', self.text("Renamed.md"))


    # -- item 7: history must follow the note through a rename ------------
    def versions(self, rel):
        return self.get("/api/history", path=rel)["versions"]

    def version_text(self, rel, at):
        return self.get("/api/history", path=rel, at=at)["text"]

    def with_history(self, rel, name, srcs):
        """Leave `rel` with its newest kept version referencing `srcs`.

        A save snapshots the text it replaces, normally at most once every
        SNAPSHOT_EVERY; the gate is opened here so two saves keep a version.
        setUp saved it, so tearDown puts it back.
        """
        server.SNAPSHOT_EVERY = 0
        self.write(rel, note(name, srcs, "before"))
        self.write(rel, note(name, srcs, "after"))

    def test_a_version_saved_before_a_rename_still_finds_its_images(self):
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"SHOT")
        self.with_history("A.md", "A", [img])
        self.rename("A.md", "C.md")
        kept = self.versions("C.md")                    # newest first
        old = self.version_text("C.md", kept[0]["at"])
        self.assertIn("images/C1.png", old)
        self.assertNotIn("images/A1.png", old)
        self.assertIn('title: "C"', old)
        self.post("/api/restore", {"path": "C.md", "at": kept[0]["at"]})
        self.assertEqual(self.refs("C.md"), ["C1.png"])
        self.assertEqual((self.notes / "images" / "C1.png").read_bytes(), b"SHOT")
        self.assertIn("before", self.text("C.md"))
        # what the restore stepped away from is itself kept
        self.assertTrue(any("after" in self.version_text("C.md", v["at"])
                            for v in self.versions("C.md")))

    def test_an_action_step_saved_before_a_rename_still_finds_its_images(self):
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"SHOT")
        self.write("A.md", note("A", [img]))
        snap = json.dumps({"meta": {"title": "A"}, "elements": [
            {"id": "t1", "type": "text",
             "html": '<p><img src="images/A1.png"> and images/A1.png in prose</p>'}]})
        self.post("/api/actions", {"path": "A.md", "actions": [
            {"id": "s1", "label": "Pasted an image", "at": 1, "snap": snap}]})
        self.rename("A.md", "C.md")
        log = self.get("/api/actions", path="C.md")["actions"]
        doc = json.loads(log[0]["snap"])
        self.assertIn('src="images/C1.png"', doc["elements"][0]["html"])
        self.assertIn("images/A1.png in prose", doc["elements"][0]["html"])
        self.assertEqual(doc["meta"]["title"], "C")

    def test_history_survives_a_move_that_has_to_take_a_free_name(self):
        self.post("/api/create", {"path": "Box", "kind": "folder"})
        (self.notes / "Box" / "images").mkdir(parents=True)
        (self.notes / "Box" / "images" / "K1.png").write_bytes(b"THEIRS")
        self.write("Box/Keeper.md", note("Keeper", ["K1.png"]))
        self.write("K.md", note("K"))
        mine = self.upload("K.md", b"MINE")             # images/K1.png, same name
        self.with_history("K.md", "K", [mine])
        self.rename("K.md", "Box/K.md")
        landed = self.refs("Box/K.md")[0]
        self.assertNotEqual(landed, "K1.png")
        old = self.version_text("Box/K.md", self.versions("Box/K.md")[0]["at"])
        self.assertIn("images/" + landed, old)
        self.assertEqual((self.notes / "Box" / "images" / landed).read_bytes(), b"MINE")

    def test_repeated_renames_leave_history_pointing_at_the_current_names(self):
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"SHOT")
        self.with_history("A.md", "A", [img])
        self.rename("A.md", "B.md")
        self.rename("B.md", "C.md")
        at = self.versions("C.md")[0]["at"]
        old = self.version_text("C.md", at)
        self.assertIn("images/C1.png", old)
        self.assertTrue((self.notes / "images" / "C1.png").is_file())

    def test_rewriting_history_does_not_reorder_it(self):
        server.SNAPSHOT_EVERY = 0                  # keep a version per save
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"SHOT")
        for body in ("one", "two", "three"):
            self.write("A.md", note("A", [img], body))
        kept = sorted((server.HISTORY / "A.md").glob("*.md"))
        self.assertEqual(len(kept), 3)
        # deliberately out of step with the filenames: order is when it was
        # taken, and a rewrite that restamped a file would shuffle the page.
        now = time.time()
        for f, when in zip(kept, (now - 100, now - 300, now - 200)):
            os.utime(f, (when, when))
        before = [v["at"] for v in self.versions("A.md")]
        self.rename("A.md", "C.md")
        self.assertEqual([v["at"] for v in self.versions("C.md")], before)
        self.assertIn("images/C1.png", self.version_text("C.md", before[0]))

    def test_a_folder_rename_leaves_its_notes_history_alone(self):
        self.post("/api/create", {"path": "Box", "kind": "folder"})
        (self.notes / "Box" / "images").mkdir(parents=True)
        (self.notes / "Box" / "images" / "N1.png").write_bytes(b"IN A BOX")
        self.with_history("Box/N.md", "N", ["N1.png"])
        self.rename("Box", "Crate")
        at = self.versions("Crate/N.md")[0]["at"]
        old = self.version_text("Crate/N.md", at)
        self.assertIn("images/N1.png", old)         # the folder moved as one
        self.assertIn('title: N', old)              # and no note was retitled
        self.assertEqual((self.notes / "Crate" / "images" / "N1.png").read_bytes(),
                         b"IN A BOX")

    def test_canvas_image_action_source_follows_rename(self):
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"CANVAS")
        self.write("A.md", note("A", [img]))
        snap = json.dumps({"meta": {"title": "A"}, "elements": [
            {"type": "image", "src": "images/" + img}]})
        self.post("/api/actions", {"path": "A.md", "actions": [
            {"id": "i", "label": "Added image", "at": 1, "snap": snap}]})
        self.rename("A.md", "B.md")
        action = self.get("/api/actions", path="B.md")["actions"][0]
        src = json.loads(action["snap"])["elements"][0]["src"]
        self.assertEqual(src, "images/B1.png")
        self.assertEqual((self.notes / src).read_bytes(), b"CANVAS")

    def test_history_only_image_moves_and_restores_with_collision(self):
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"HISTORY")
        self.with_history("A.md", "A", [img])
        self.write("A.md", note("A", body="removed image"))
        self.folder("Box")
        (self.notes / "Box/images").mkdir()
        (self.notes / "Box/images/A1.png").write_bytes(b"OTHER")
        self.rename("A.md", "Box/A.md")
        version = next(v for v in self.versions("Box/A.md")
                       if "src: images/" in self.version_text("Box/A.md", v["at"]))
        self.post("/api/restore", {"path": "Box/A.md", "at": version["at"]})
        restored = self.refs("Box/A.md")[0]
        self.assertNotEqual(restored, "A1.png")
        self.assertEqual((self.notes / "Box/images" / restored).read_bytes(), b"HISTORY")
        self.assertEqual((self.notes / "Box/images/A1.png").read_bytes(), b"OTHER")

    def test_action_only_image_moves_and_peer_history_keeps_its_copy(self):
        self.write("A.md", note("A"))
        img = self.upload("A.md", b"SHARED HISTORY")
        self.with_history("Peer.md", "Peer", [img])
        self.write("Peer.md", note("Peer", body="removed"))
        snap = json.dumps({"meta": {"title": "A"}, "elements": [
            {"type": "image", "src": "images/" + img}]})
        self.post("/api/actions", {"path": "A.md", "actions": [
            {"id": "i", "label": "Added image", "at": 1, "snap": snap}]})
        self.folder("Box")
        self.rename("A.md", "Box/B.md")
        action = self.get("/api/actions", path="Box/B.md")["actions"][0]
        src = json.loads(action["snap"])["elements"][0]["src"]
        self.assertEqual((self.notes / "Box" / src).read_bytes(), b"SHARED HISTORY")
        self.assertEqual((self.notes / "images" / img).read_bytes(), b"SHARED HISTORY")

    # -- sidebar order and the archive drawer ------------------------------
    def folder(self, name):
        self.post("/api/create", {"path": name, "kind": "folder"})

    def names(self, rel=""):
        """What the sidebar would paint for one column, in its own order."""
        tree = self.get("/api/tree")["tree"]
        if rel:
            tree = next(f for f in tree["folders"] if f["path"] == rel)
        return [f["path"] for f in tree["folders"]] + [n["path"] for n in tree["notes"]]

    def test_a_dragged_order_outlives_the_process_that_saved_it(self):
        for name in ("A", "B", "C"):
            self.folder(name)
        self.assertEqual(self.names(), ["A", "B", "C"])        # alphabetical to begin with
        self.post("/api/order", {"parent": "", "paths": ["C", "A", "B"]})
        self.assertEqual(self.names(), ["C", "A", "B"])
        # the order lives in the notebook, not in the server: a fresh read of
        # the sidecar is all a restart has to go on.
        self.assertEqual(json.loads((self.notes / ".paper.json").read_text())["order"],
                         {"": ["C", "A", "B"]})

    def test_a_folder_nobody_has_moved_lands_among_the_ones_that_were(self):
        for name in ("A", "B"):
            self.folder(name)
        self.post("/api/order", {"parent": "", "paths": ["B", "A"]})
        self.folder("C")
        self.assertEqual(self.names(), ["B", "A", "C"])

    def test_pages_keep_the_order_they_were_dragged_into(self):
        self.folder("Box")
        for name in ("One", "Two", "Three"):
            self.write("Box/%s.md" % name, note(name))
        self.post("/api/order", {"parent": "Box",
                                 "paths": ["Box/Two.md", "Box/One.md", "Box/Three.md"]})
        self.assertEqual(self.names("Box"), ["Box/Two.md", "Box/One.md", "Box/Three.md"])

    def test_a_rename_keeps_a_folder_in_its_slot_and_its_pages_in_theirs(self):
        for name in ("A", "B", "C"):
            self.folder(name)
        self.write("B/One.md", note("One"))
        self.write("B/Two.md", note("Two"))
        self.post("/api/order", {"parent": "", "paths": ["C", "B", "A"]})
        self.post("/api/order", {"parent": "B", "paths": ["B/Two.md", "B/One.md"]})
        self.rename("B", "Bee")
        self.assertEqual(self.names(), ["C", "Bee", "A"])
        self.assertEqual(self.names("Bee"), ["Bee/Two.md", "Bee/One.md"])

    def test_a_note_dragged_to_another_folder_leaves_its_old_slot_behind(self):
        self.folder("A")
        self.folder("B")
        self.write("A/One.md", note("One"))
        self.write("A/Two.md", note("Two"))
        self.write("B/Zed.md", note("Zed"))
        self.post("/api/order", {"parent": "A", "paths": ["A/Two.md", "A/One.md"]})
        self.post("/api/order", {"parent": "B", "paths": ["B/Zed.md"]})
        self.rename("A/Two.md", "B/Two.md")
        self.assertEqual(self.names("A"), ["A/One.md"])
        self.assertEqual(self.names("B"), ["B/Zed.md", "B/Two.md"])

    def test_an_archived_folder_stays_out_of_search_until_it_is_asked_for(self):
        self.folder("Live")
        self.folder("Old")
        self.write("Live/Here.md", note("Here", body="needle"))
        self.write("Old/Gone.md", note("Gone", body="needle"))
        self.post("/api/archive", {"path": "Old", "archived": True})
        tree = self.get("/api/tree")["tree"]
        self.assertEqual([(f["path"], f["archived"]) for f in tree["folders"]],
                         [("Live", False), ("Old", True)])
        self.assertEqual([m["path"] for m in self.get("/api/search", q="needle")["matches"]],
                         ["Live/Here.md"])
        found = self.get("/api/search", q="needle", archived=1)["matches"]
        self.assertEqual(sorted(m["path"] for m in found), ["Live/Here.md", "Old/Gone.md"])
        self.post("/api/archive", {"path": "Old", "archived": False})
        self.assertEqual(len(self.get("/api/search", q="needle")["matches"]), 2)

    def test_an_archived_folder_carries_the_flag_through_a_rename(self):
        self.folder("Old")
        self.post("/api/archive", {"path": "Old", "archived": True})
        self.rename("Old", "Older")
        tree = self.get("/api/tree")["tree"]
        self.assertEqual([(f["path"], f["archived"]) for f in tree["folders"]],
                         [("Older", True)])

    def test_trashing_a_folder_forgets_where_it_sat_and_that_it_was_archived(self):
        self.folder("A")
        self.folder("B")
        self.write("A/One.md", note("One"))
        self.post("/api/order", {"parent": "", "paths": ["B", "A"]})
        self.post("/api/order", {"parent": "A", "paths": ["A/One.md"]})
        self.post("/api/archive", {"path": "A", "archived": True})
        self.post("/api/delete", {"path": "A"})
        meta = json.loads((self.notes / ".paper.json").read_text())
        self.assertEqual(meta["order"], {"": ["B"]})
        self.assertEqual(meta["archived"], [])

    def test_the_order_only_ever_holds_paths_from_the_column_it_names(self):
        self.folder("A")
        self.write("A/One.md", note("One"))
        kept = self.post("/api/order", {"parent": "", "paths": ["A", "A/One.md", "A", 7]})
        self.assertEqual(kept["paths"], ["A"])      # no strays, no repeats, no junk


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""
Backend regressions for server.py - the half of the app app/test.html cannot see.

    python3 test_server.py

Every test runs the real handler over HTTP against a throwaway notebook in a
temporary directory. Your own notes are never opened.
"""

import json
import shutil
import tempfile
import unittest
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

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
        self.saved = {k: getattr(server, k) for k in ("NOTES", "META_FILE", "HISTORY")}
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


if __name__ == "__main__":
    unittest.main(verbosity=2)

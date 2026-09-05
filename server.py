#!/usr/bin/env python3
"""
Paper - a local, file-backed notebook.

Zero dependencies: Python standard library only. Notes live as Markdown files
under ./notes and the on-disk folder tree IS the notebook tree.

    python3 server.py            # http://127.0.0.1:8420
    python3 server.py --port 9000 --no-open
"""

import argparse
import json
import mimetypes
import re
import shutil
import time
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app"
NOTES = ROOT / "notes"
META_FILE = NOTES / ".paper.json"
HISTORY = NOTES / ".history"

SNAPSHOT_EVERY = 10 * 60      # seconds between kept versions of a note
SNAPSHOTS_KEPT = 30
ACTIONS_KEPT = 100            # steps in a note's action log

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
HIDDEN = {"images", ".trash", ".history"}
NOTE_EMOJIS = {"❤️", "🔥", "🍕", "🌴"}

mimetypes.add_type("application/font-woff2", ".woff2")
mimetypes.add_type("text/javascript", ".js")


# --------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------

def resolve(rel):
    """Resolve a notes-relative path, refusing anything that escapes the root."""
    rel = (rel or "").strip().replace("\\", "/").lstrip("/")
    p = (NOTES / rel).resolve()
    if p != NOTES and NOTES.resolve() not in p.parents:
        raise ValueError("path escapes the notes root: %r" % rel)
    return p


def relpath(p):
    return p.resolve().relative_to(NOTES.resolve()).as_posix()


def today():
    return datetime.now().strftime("%d%b%Y").upper()


def unique(path):
    """Return `path` or the first `name (2).ext` style variant that is free."""
    if not path.exists():
        return path
    stem, suffix, n = path.stem, path.suffix, 2
    while True:
        cand = path.with_name(f"{stem} ({n}){suffix}")
        if not cand.exists():
            return cand
        n += 1


# --------------------------------------------------------------------------
# note file parsing (scalars + plain text only; the browser owns the full model)
# --------------------------------------------------------------------------

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)\Z", re.S)


def split_note(text):
    """-> (frontmatter_scalars, body). Nested `elements:` data is skipped."""
    m = FM_RE.match(text)
    if not m:
        return {}, text
    fm, body = {}, m.group(1)
    for line in body.splitlines():
        if not line or line[0] in " \t-":
            continue  # nested / list content belongs to the browser
        k, sep, v = line.partition(":")
        if not sep:
            continue
        v = v.strip()
        if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        fm[k.strip()] = v
    return fm, m.group(2)


def plain_text(body):
    """Body -> searchable prose, with markup stripped."""
    t = re.sub(r"<!--@[^>]*-->", " ", body)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[\[([^\]|]*)(?:\|[^\]]*)?\]\]", r"\1", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"(?m)^[ \t]{0,16}(?:[-*+]|\d+[.)])[ \t]+", " ", t)
    t = re.sub(r"(?m)^[ \t]*#{1,6}[ \t]+", " ", t)
    t = re.sub(r"[*_`~|]", "", t)
    t = re.sub(r"\\(.)", r"\1", t)
    return re.sub(r"[ \t]+", " ", t)


def note_meta(path):
    try:
        text = path.read_text("utf-8")
    except OSError:
        return {}, ""
    fm, body = split_note(text)
    labels = " ".join(re.findall(r"(?m)^\s+label:[ \t]*(.*)$", text))
    return fm, "\n".join([fm.get("title", path.stem), labels, plain_text(body)])


# a real reference to a sibling image: `src: images/x`, `src="images/x"` or
# `](images/x)`. Prose that merely names a path is not one.
IMG_REF = re.compile(r"""(?:\bsrc\s*[:=]\s*|\]\(\s*)["']?images/""")


def image_refs(text, names):
    """-> the subset of `names` that `text` references as images/<name>.

    Names are matched longest first, so `images/A11.png` is read as A11.png and
    never as A1.png with a stray "1" after it. Matching whole filenames this way
    also keeps note names holding glob or regex characters out of the question.
    """
    ordered = sorted(names, key=len, reverse=True)
    found = set()
    for m in IMG_REF.finditer(text):
        for name in ordered:
            if text.startswith(name, m.end()):
                found.add(name)
                break
    return found


def renamed_image(name, old_stem, new_stem):
    """`<old stem><n>.ext` follows its note's new name; anything else keeps its own."""
    rest = name[len(old_stem):]
    return new_stem + rest if name.startswith(old_stem) and rest[:1].isdigit() else name


def apply_image_renames(text, renamed):
    """Point every image reference at its new filename, longest name first."""
    if not renamed:
        return text
    ordered = sorted(renamed, key=len, reverse=True)
    out, pos = [], 0
    for m in IMG_REF.finditer(text):
        for name in ordered:
            if text.startswith(name, m.end()):
                out.append(text[pos:m.end()] + renamed[name])
                pos = m.end() + len(name)
                break
    out.append(text[pos:])
    return "".join(out)


def rewrite_renamed_note(path, new_stem, renamed):
    """Keep the visible title and the moved images' references aligned to a rename."""
    try:
        text = path.read_text("utf-8")
    except OSError:
        return
    match = FM_RE.match(text)
    if match:
        frontmatter, body = match.group(1), match.group(2)
        title = "title: " + json.dumps(new_stem, ensure_ascii=False)
        if re.search(r"(?m)^title:.*$", frontmatter):
            frontmatter = re.sub(r"(?m)^title:.*$", lambda _: title, frontmatter, count=1)
        else:
            frontmatter = title + "\n" + frontmatter
        text = "---\n" + frontmatter + "\n---\n" + body
    path.write_text(apply_image_renames(text, renamed), "utf-8")


# --------------------------------------------------------------------------
# tree + sidecar metadata (folder colours, kept out of the notes themselves)
# --------------------------------------------------------------------------

def load_meta():
    try:
        return json.loads(META_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_meta(meta):
    NOTES.mkdir(parents=True, exist_ok=True)
    META_FILE.write_text(json.dumps(meta, indent=2), "utf-8")


PALETTE = ["#d8574b", "#e08a2e", "#d9b52c", "#5aa552", "#3d9aa8",
           "#4a7fd4", "#8a63c9", "#c05a9c", "#7d8794"]


def folder_color(meta, rel, index):
    return meta.get("colors", {}).get(rel) or PALETTE[index % len(PALETTE)]


def build_tree(dirpath, meta, counter, depth=0):
    """Build only the root and one folder level.

    Paper deliberately has no folders within folders. Deeper directories may
    still exist on disk, but they and their notes are left out of the app.
    """
    rel = "" if dirpath == NOTES else relpath(dirpath)
    folders, notes = [], []
    for child in sorted(dirpath.iterdir(), key=lambda c: c.name.lower()):
        if child.name.startswith(".") or child.name in HIDDEN:
            continue
        if child.is_dir():
            if depth:
                continue
            counter[0] += 1
            node = build_tree(child, meta, counter, depth + 1)
            node["color"] = folder_color(meta, node["path"], counter[0] - 1)
            folders.append(node)
        elif child.suffix.lower() == ".md":
            fm, _ = note_meta(child)
            notes.append({
                "path": relpath(child),
                "name": child.stem,
                "title": fm.get("title") or child.stem,
                "created": fm.get("created", ""),
                "modified": fm.get("modified", ""),
                "mtime": child.stat().st_mtime,
                "emoji": meta.get("emojis", {}).get(relpath(child), ""),
            })
    return {"path": rel, "name": dirpath.name if rel else "Notes",
            "folders": folders, "notes": notes}


def all_notes():
    notes = []
    for path in NOTES.rglob("*.md"):
        parts = path.relative_to(NOTES).parts
        if len(parts) > 2 or any(part.startswith(".") or part in HIDDEN for part in parts):
            continue
        notes.append(path)
    return notes


# --------------------------------------------------------------------------
# version snapshots
# --------------------------------------------------------------------------

def snapshot_dir(path):
    return HISTORY / relpath(path)


def versions_of(folder):
    """Oldest first. Ordered by when the snapshot was taken, not by name, so a
    same-second collision suffix can't reorder them."""
    if not folder.is_dir():
        return []
    return sorted(folder.glob("*.md"), key=lambda f: f.stat().st_mtime)


def snapshot(path, force=False):
    """Park the current contents of `path` before it is overwritten.

    Autosave fires every second or so, which would be useless as history, so a
    new version is normally only kept once the newest one is SNAPSHOT_EVERY old.
    `force` overrides that, for the copy taken just before a restore."""
    if not path.is_file():
        return
    folder = snapshot_dir(path)
    kept = versions_of(folder)
    if not force and kept and time.time() - kept[-1].stat().st_mtime < SNAPSHOT_EVERY:
        return
    current = path.read_bytes()
    if any(k.read_bytes() == current for k in kept[-2:]):
        return                                   # nothing new to remember
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = folder / f"{stamp}.md"
    n = 1
    while target.exists():                       # same-second collisions
        target = folder / f"{stamp}-{n}.md"
        n += 1
    shutil.copyfile(path, target)               # mtime = when we snapshotted
    for old in versions_of(folder)[:-SNAPSHOTS_KEPT]:
        old.unlink()


def move_history(src, dst):
    """Carry a note's snapshots and action log across a rename or a move."""
    if not src.is_dir() or src == dst or dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def snapshot_list(path):
    out = []
    for f in reversed(versions_of(snapshot_dir(path))):
        day, clock = f.stem.split("-")[:2]
        when = datetime.strptime(day, "%Y%m%d").strftime("%d%b%Y").upper()
        out.append({"at": f.stem, "date": when,
                    "time": f"{clock[:2]}:{clock[2:4]}",
                    "bytes": f.stat().st_size})
    return out


# --------------------------------------------------------------------------
# the action log: a named, step-by-step record of what was done to a note
# --------------------------------------------------------------------------
#
# Distinct from the time-based snapshots above: those are "the file, ten
# minutes ago", this is "you deleted a row, then pasted 300 characters". Each
# step carries the whole document state, so the History page can jump back to
# any of them. It lives beside the snapshots, as one JSON file per note.

def actions_file(path):
    return snapshot_dir(path) / "actions.json"


def read_actions(path):
    f = actions_file(path)
    if not f.is_file():
        return []
    try:
        log = json.loads(f.read_text("utf-8"))
    except (ValueError, OSError):
        return []
    return log if isinstance(log, list) else []


def write_actions(path, log):
    if not isinstance(log, list):
        raise ValueError("action log must be a list")
    f = actions_file(path)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(log[-ACTIONS_KEPT:]), "utf-8")


# --------------------------------------------------------------------------
# boolean search:  term  "quoted phrase"  AND  OR  NOT  ( )   [implicit AND]
# --------------------------------------------------------------------------

TOKEN_RE = re.compile(r'"([^"]*)"|(\()|(\))|([^\s()"]+)')


def tokenize(query):
    out = []
    for m in TOKEN_RE.finditer(query):
        phrase, lp, rp, word = m.groups()
        if phrase is not None:
            out.append(("TERM", phrase.lower()))
        elif lp:
            out.append(("LP", lp))
        elif rp:
            out.append(("RP", rp))
        elif word in ("AND", "OR", "NOT"):        # operators are UPPERCASE only
            out.append((word, word))
        else:
            out.append(("TERM", word.lower()))
    return out


class Parser:
    """expr := or ;  or := and (OR and)* ;  and := unary (AND? unary)* ;
       unary := NOT unary | '(' expr ')' | TERM"""

    def __init__(self, tokens):
        self.t, self.i = tokens, 0

    def peek(self):
        return self.t[self.i][0] if self.i < len(self.t) else None

    def parse(self):
        node = self.parse_or()
        while self.peek() == "RP":       # tolerate stray closers
            self.i += 1
        return node

    def parse_or(self):
        node = self.parse_and()
        while self.peek() == "OR":
            self.i += 1
            node = ("or", node, self.parse_and())
        return node

    def parse_and(self):
        node = self.parse_unary()
        while self.peek() in ("TERM", "NOT", "LP", "AND"):
            if self.peek() == "AND":
                self.i += 1
                if self.peek() is None:
                    break
            node = ("and", node, self.parse_unary())
        return node

    def parse_unary(self):
        kind = self.peek()
        if kind == "NOT":
            self.i += 1
            return ("not", self.parse_unary())
        if kind == "LP":
            self.i += 1
            node = self.parse_or()
            if self.peek() == "RP":
                self.i += 1
            return node
        if kind == "TERM":
            term = self.t[self.i][1]
            self.i += 1
            return ("term", term)
        self.i += 1                      # skip anything unexpected
        return ("true",)


def evaluate(node, haystack):
    kind = node[0]
    if kind == "term":
        return node[1] in haystack
    if kind == "and":
        return evaluate(node[1], haystack) and evaluate(node[2], haystack)
    if kind == "or":
        return evaluate(node[1], haystack) or evaluate(node[2], haystack)
    if kind == "not":
        return not evaluate(node[1], haystack)
    return True


def collect_terms(node, acc):
    if node[0] == "term":
        acc.append(node[1])
    elif node[0] == "not":
        pass                              # never highlight excluded words
    elif node[0] in ("and", "or"):
        collect_terms(node[1], acc)
        collect_terms(node[2], acc)
    return acc


def search(query):
    tokens = tokenize(query.strip())
    if not tokens:
        return None
    ast = Parser(tokens).parse()
    terms = collect_terms(ast, [])
    hits = []
    for path in all_notes():
        fm, text = note_meta(path)
        low = text.lower()
        if not evaluate(ast, low):
            continue
        pos = min((low.find(t) for t in terms if t and low.find(t) >= 0), default=-1)
        snippet = ""
        if pos >= 0:
            start = max(0, pos - 40)
            snippet = ("..." if start else "") + text[start:pos + 120].strip() + "..."
        hits.append({"path": relpath(path), "snippet": " ".join(snippet.split())})
    return {"matches": hits, "terms": terms}


# --------------------------------------------------------------------------
# [[wiki links]] -> backlinks
# --------------------------------------------------------------------------

def link_graph():
    notes = all_notes()
    by_key = {}
    for p in notes:
        fm, _ = note_meta(p)
        by_key.setdefault(p.stem.lower(), relpath(p))
        title = (fm.get("title") or "").lower()
        if title:
            by_key.setdefault(title, relpath(p))
    back = {}
    for p in notes:
        body = p.read_text("utf-8", errors="replace")
        src = relpath(p)
        for raw in re.findall(r"\[\[([^\]|]+)", body):
            target = by_key.get(raw.strip().lower())
            if target and target != src:
                back.setdefault(target, [])
                if src not in back[target]:
                    back[target].append(src)
    return {"backlinks": back, "names": sorted(by_key)}


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

BLANK = """---
title: {title}
created: {date}
modified: {date}
font: Roboto
elements:
  - id: t1
    type: text
    x: 40
    y: 40
    w: 620
---

<!--@t1-->
"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Paper"

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/api/changes", "/app/", "/notes/")):
            print("  %s %s" % (self.command, self.path))

    # -- helpers ----------------------------------------------------------
    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, data, ctype, cache=False):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.end_headers()
        self.wfile.write(data)

    def fail(self, msg, status=400):
        self.send_json({"error": str(msg)}, status)

    def body_bytes(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def body_json(self):
        raw = self.body_bytes()
        return json.loads(raw.decode("utf-8")) if raw else {}

    @property
    def query(self):
        return {k: v[0] for k, v in
                urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}

    # -- routing ----------------------------------------------------------
    def do_GET(self):
        route = urllib.parse.urlparse(self.path).path
        try:
            if route.startswith("/api/"):
                return self.api_get(route)
            return self.static(route)
        except Exception as exc:                      # noqa: BLE001
            self.fail(exc, 500)

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        try:
            return self.api_post(route)
        except Exception as exc:                      # noqa: BLE001
            self.fail(exc, 500)

    do_PUT = do_POST

    # -- static -----------------------------------------------------------
    def static(self, route):
        if route in ("/", "/index.html"):
            target = APP / "index.html"
        elif route.startswith("/notes/"):
            target = resolve(urllib.parse.unquote(route[len("/notes/"):]))
        else:
            target = (APP / urllib.parse.unquote(route.lstrip("/"))).resolve()
            if APP.resolve() not in target.parents:
                return self.fail("forbidden", 403)
        if not target.is_file():
            return self.fail("not found: %s" % route, 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json")):
            ctype += "; charset=utf-8"
        self.send_bytes(target.read_bytes(), ctype, cache=target.suffix == ".woff2")

    # -- API --------------------------------------------------------------
    def api_get(self, route):
        q = self.query
        if route == "/api/tree":
            meta = load_meta()
            NOTES.mkdir(parents=True, exist_ok=True)
            return self.send_json({"tree": build_tree(NOTES, meta, [0]),
                                   "palette": PALETTE})
        if route == "/api/note":
            path = resolve(q.get("path"))
            if not path.is_file():
                return self.fail("no such note", 404)
            return self.send_json({"path": relpath(path),
                                   "text": path.read_text("utf-8"),
                                   "mtime": path.stat().st_mtime})
        if route == "/api/search":
            result = search(q.get("q", ""))
            return self.send_json(result or {"matches": None, "terms": []})
        if route == "/api/history":
            path = resolve(q.get("path"))
            at = q.get("at")
            if at:
                version = snapshot_dir(path) / (re.sub(r"[^0-9-]", "", at) + ".md")
                if not version.is_file():
                    return self.fail("no such version", 404)
                return self.send_json({"text": version.read_text("utf-8")})
            return self.send_json({"versions": snapshot_list(path)})
        if route == "/api/actions":
            return self.send_json({"actions": read_actions(resolve(q.get("path")))})
        if route == "/api/links":
            return self.send_json(link_graph())
        if route == "/api/changes":
            since = float(q.get("since") or 0)
            changed = [relpath(p) for p in all_notes() if p.stat().st_mtime > since]
            return self.send_json({"now": time.time(), "changed": changed,
                                   "count": len(all_notes())})
        return self.fail("unknown endpoint %s" % route, 404)

    def api_post(self, route):
        q = self.query
        if route == "/api/note":                       # PUT body = full file text
            path = resolve(q.get("path"))
            path.parent.mkdir(parents=True, exist_ok=True)
            snapshot(path)
            path.write_bytes(self.body_bytes())
            return self.send_json({"path": relpath(path), "mtime": path.stat().st_mtime})

        data = self.body_json() if route != "/api/image" else {}

        if route == "/api/create":
            path = resolve(data.get("path"))
            if data.get("kind") == "folder":
                if path.parent.resolve() != NOTES.resolve():
                    return self.fail("folders can only be created at the notes root")
                path.mkdir(parents=True, exist_ok=True)
            else:
                if path.suffix.lower() != ".md":
                    path = path.with_suffix(".md")
                parent = path.parent.resolve()
                if parent != NOTES.resolve() and parent.parent != NOTES.resolve():
                    return self.fail("notes can only be loose or inside one root folder")
                path = unique(path)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(BLANK.format(title=path.stem, date=today()), "utf-8")
            return self.send_json({"path": relpath(path)})

        if route in ("/api/rename", "/api/move"):
            src, dst = resolve(data.get("from")), resolve(data.get("to"))
            if src.is_file() and dst.suffix.lower() != ".md":
                dst = dst.with_suffix(".md")
            if src.is_dir() and dst.parent.resolve() != NOTES.resolve():
                return self.fail("folders cannot be placed inside folders")
            parent = dst.parent.resolve()
            if src.is_file() and parent != NOTES.resolve() and parent.parent != NOTES.resolve():
                return self.fail("notes can only be loose or inside one root folder")
            if src == dst:
                return self.send_json({"path": relpath(src)})
            was_note = src.is_file()
            old_rel = relpath(src)
            old_src_history = snapshot_dir(src)
            dst = unique(dst)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            if was_note:
                rewrite_renamed_note(dst, dst.stem, self.move_images(src, dst))
            move_history(old_src_history, snapshot_dir(dst))
            meta = load_meta()
            colors = meta.get("colors", {})
            new_rel = relpath(dst)
            if old_rel in colors:                 # keep a folder's colour
                colors[new_rel] = colors.pop(old_rel)
            emojis = meta.get("emojis", {})
            if was_note and old_rel in emojis:
                emojis[new_rel] = emojis.pop(old_rel)
            elif not was_note:
                for key in list(emojis):
                    if key.startswith(old_rel + "/"):
                        emojis[new_rel + key[len(old_rel):]] = emojis.pop(key)
            if colors or emojis:
                save_meta(meta)
            return self.send_json({"path": relpath(dst)})

        if route == "/api/delete":                     # non-destructive: -> .trash
            path = resolve(data.get("path"))
            old_rel = relpath(path)
            trash = NOTES / ".trash" / datetime.now().strftime("%Y%m%d-%H%M%S")
            trash.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(trash / path.name))
            meta = load_meta()
            for field in ("colors", "emojis"):
                values = meta.get(field, {})
                for key in list(values):
                    if key == old_rel or key.startswith(old_rel + "/"):
                        values.pop(key)
            if meta:
                save_meta(meta)
            return self.send_json({"trashed": relpath(trash / path.name)})

        if route == "/api/restore":
            path = resolve(data.get("path"))
            version = snapshot_dir(path) / (re.sub(r"[^0-9-]", "", data.get("at", "")) + ".md")
            if not version.is_file():
                return self.fail("no such version", 404)
            snapshot(path, force=True)          # never lose what is there now
            shutil.copyfile(version, path)
            return self.send_json({"path": relpath(path), "mtime": path.stat().st_mtime})

        if route == "/api/actions":
            path = resolve(data.get("path"))
            write_actions(path, data.get("actions") or [])
            return self.send_json({"ok": True})

        if route == "/api/color":
            meta = load_meta()
            meta.setdefault("colors", {})[data["path"]] = data["color"]
            save_meta(meta)
            return self.send_json({"ok": True})

        if route == "/api/emoji":
            path = resolve(data.get("path"))
            if not path.is_file() or path.suffix.lower() != ".md":
                return self.fail("no such note", 404)
            emoji = data.get("emoji") or ""
            if emoji and emoji not in NOTE_EMOJIS:
                return self.fail("unsupported note emoji")
            meta = load_meta()
            emojis = meta.setdefault("emojis", {})
            if emoji:
                emojis[relpath(path)] = emoji
            else:
                emojis.pop(relpath(path), None)
            save_meta(meta)
            return self.send_json({"ok": True, "emoji": emoji})

        if route == "/api/image-path":
            note = resolve(data.get("path"))
            src = str(data.get("src") or "")
            if not note.is_file() or not src or re.match(r"^(?:https?:|data:|blob:|/)", src):
                return self.fail("image does not have a local file path")
            target = (note.parent / src).resolve()
            if NOTES.resolve() not in target.parents or not target.is_file():
                return self.fail("no such local image", 404)
            return self.send_json({"path": str(target)})

        if route == "/api/image":
            note = resolve(q.get("path"))
            ext = "." + (q.get("ext") or "png").lstrip(".").lower()
            if ext not in IMAGE_EXT:
                return self.fail("unsupported image type %s" % ext)
            folder = note.parent / "images"
            folder.mkdir(parents=True, exist_ok=True)
            n = 1
            while (folder / f"{note.stem}{n}{ext}").exists():
                n += 1
            target = folder / f"{note.stem}{n}{ext}"
            target.write_bytes(self.body_bytes())
            return self.send_json({"src": f"images/{target.name}", "name": target.name})

        return self.fail("unknown endpoint %s" % route, 404)

    @staticmethod
    def move_images(src, dst):
        """Carry the images a renamed note actually references, and say how.

        Ownership comes from the note's own references, not from a filename
        prefix, so A11.png stays with A1.md when A.md becomes B.md. An image a
        note left behind still references is copied rather than taken away, and
        an existing file in the destination is never written over.

        -> {old filename: new filename} for the references the caller rewrites.
        """
        old, new = src.parent / "images", dst.parent / "images"
        if not old.is_dir():
            return {}
        try:
            text = dst.read_text("utf-8")
        except OSError:
            return {}
        mine = image_refs(text, {p.name for p in old.iterdir() if p.is_file()})
        if not mine:
            return {}
        shared = set()
        for peer in src.parent.glob("*.md"):        # notes sharing the old folder
            if peer == dst or not peer.is_file():
                continue
            try:
                shared |= image_refs(peer.read_text("utf-8"), mine)
            except OSError:
                continue
        renamed = {}
        for name in sorted(mine):
            img = old / name
            want = new / renamed_image(name, src.stem, dst.stem)
            if want == img:                         # already named and placed right
                continue
            new.mkdir(parents=True, exist_ok=True)
            want = unique(want)
            if name in shared:
                shutil.copyfile(str(img), str(want))    # the other note keeps it
            else:
                shutil.move(str(img), str(want))
            renamed[name] = want.name
        return renamed


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8420)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-open", action="store_true", help="don't launch a browser")
    args = ap.parse_args()

    NOTES.mkdir(parents=True, exist_ok=True)
    url = f"http://{args.host}:{args.port}/"
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Paper  ->  {url}\n  notes: {NOTES}\n  ctrl-c to stop\n")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()

// GET /api/dir-list?path=<abs>[&files=1] — the entries of an absolute path, for the in-browser
// folder / file picker. The native OS dialog (/api/pick-file) opens on the SERVER's display,
// which is useless from a remote browser (a phone over Tailscale), so a remote client navigates
// the filesystem here instead and posts back the chosen absolute path. Directories only by
// default; `files=1` also lists files so the same picker can choose one to attach to a session.
//
// Read-only: never returns file contents, only names + a dir flag, so the same-origin policy on
// the response body is enough — a random site the user visits can issue the GET but can't read
// what comes back. Defaults to (and falls back to) the home directory.
import os from "node:os";
import path from "node:path";
import { readdirSync } from "node:fs";
import type { Express, Request } from "express";

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

// Resolve the requested path to a listable absolute directory, defaulting to home. A relative
// or missing param, or a path we can't read, all fall back to home rather than erroring — the
// picker should always show SOMETHING to navigate from.
export function resolveListPath(raw: unknown): string {
  const home = os.homedir();
  if (typeof raw !== "string" || raw.length === 0) return home;
  const abs = path.resolve(raw);
  return abs;
}

// The immediate entries of `dir` — sub-directories always, files only when `includeFiles`.
// Directories sort first (they're what you navigate), then files; both case-insensitive.
// Entries that error on stat (a dangling symlink, a permission wall) are skipped, not fatal.
export function listEntries(dir: string, includeFiles = false): DirEntry[] {
  const dirs: DirEntry[] = [];
  const files: DirEntry[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    try {
      if (d.isDirectory()) dirs.push({ name: d.name, path: path.join(dir, d.name), dir: true });
      else if (includeFiles && d.isFile()) files.push({ name: d.name, path: path.join(dir, d.name), dir: false });
    } catch {
      // unreadable entry — skip it
    }
  }
  const byName = (a: DirEntry, b: DirEntry) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return [...dirs.sort(byName), ...files.sort(byName)];
}

export function mountDirListRoute(app: Express): void {
  app.get("/api/dir-list", (req: Request, res) => {
    const dir = resolveListPath(req.query.path);
    const includeFiles = req.query.files === "1";
    let entries: DirEntry[];
    try {
      entries = listEntries(dir, includeFiles);
    } catch {
      // The requested dir vanished or isn't readable — fall back to home so the picker
      // never dead-ends. If home itself fails, report it rather than loop.
      const home = os.homedir();
      if (dir === home) return res.status(500).json({ error: "cannot read home directory" });
      try {
        return res.json({ path: home, parent: path.dirname(home), home, entries: listEntries(home, includeFiles) });
      } catch {
        return res.status(500).json({ error: "cannot read home directory" });
      }
    }
    const parent = path.dirname(dir);
    res.json({ path: dir, parent: parent === dir ? null : parent, home: os.homedir(), entries });
  });
}

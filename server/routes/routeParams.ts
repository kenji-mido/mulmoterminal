// Small query-param decisions shared by the terminal ws/session/dir routes, pulled out of
// the handlers so the parse rules live in one place (they were copied verbatim across three
// files, which is how they drift).
import type { Response } from "express";
import { workspaceRequest } from "../config/workspace.js";

// A non-negative integer index from a query param, or NaN for anything else — empty string,
// "-1", "1.5", "1e2", or a missing param. The anchored /^\d+$/ is deliberate: downstream
// resolveScript / canStartLauncher treat NaN as "no such index" and refuse, so a sloppy value
// must not slip through as some other number.
export function parseIndexParam(raw: string | null): number {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
}

// The agent a request selects, normalized. Only an exact "codex" chooses codex; everything
// else — including "CODEX", "", null, an array, or a missing param — falls back to claude, the
// default backend. Case-sensitive on purpose: the query value comes straight from a URL, and a
// mis-cased "CODEX" starting Claude is safer than guessing the user meant codex.
export function normalizeAgent(raw: unknown): "codex" | "antigravity" | "claude" {
  if (raw === "codex") return "codex";
  if (raw === "antigravity") return "antigravity";
  return "claude";
}

// The directory a `?cwd=` route is to answer about, or null once it has answered the refusal
// itself — so a handler reads `if (cwd === null) return;` and is otherwise unchanged.
//
// A route that REPORTS ON a directory must not answer about a different one under the requested
// one's name (#1151): a stale preset, a mistyped path or one mangled in transit would otherwise
// come back as the default workspace's sessions, scripts, colours and git status. 404 rather than
// an empty 200, because "there is no such directory" and "that directory has nothing" are
// different answers and only one of them is worth telling the user about — an empty 200 is the
// silence this exists to end. A path that cannot name a directory at all is a malformed request.
export function workspaceForRoute(cwd: unknown, res: Response): string | null {
  const request = workspaceRequest(cwd);
  if (request.kind !== "unusable") return request.cwd;
  res.status(request.malformed ? 400 : 404).json({ error: request.problem, cwd: request.requested });
  return null;
}

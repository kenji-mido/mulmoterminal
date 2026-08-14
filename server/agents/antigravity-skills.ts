// Skill discovery for `agy`, which is the one agent that cannot see `.claude/skills` on its
// own. claude reads it natively, grok and muse index Claude's skill roots themselves, and codex
// gets a mirror (codex-skills.ts) — agy instead discovers skills through a JSON config in its
// workspace customization dir: `.agents/skills.json`, a list of path entries to scan for
// `<name>/SKILL.md` directories (same format as Claude's).
//
// So rather than mirror files a fourth time, we register the roots the other agents already
// read: the directory's own `.claude/skills` (workspace-relative — agy resolves it against the
// repo root) and the user-global `~/.claude/skills` (where the bundled mulmoterminal-* skills
// are installed). The entries point at live directories, so a skill created mid-session — a new
// collection, say — is visible to the next agy turn with no re-sync step anywhere.
//
// Like `.agents/mcp_config.json` (antigravity-mcp.ts), the file is shared by every session in
// the directory and may be the user's own: their entries and any other fields (`inherits`,
// fields we do not know) are preserved, and a file we cannot parse is left alone entirely.
// Unlike the MCP config there is no off-switch and nothing machine-specific in what we add, so
// entries are only ever ensured present, never removed — deleting a path entry we did not write
// would break a user's own skill setup with no error anywhere.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { symlinkFreeWriteTarget } from "../infra/symlink-guard.js";
import { excludeFromGit } from "./git-exclude.js";

/** agy's workspace customization dir — the same one its MCP config lives in. */
const CUSTOMIZATION_DIR = ".agents";

export const antigravitySkillsConfigFile = (cwd: string): string => path.join(cwd, CUSTOMIZATION_DIR, "skills.json");

/** The skill roots every agy session should scan: the directory's own project skills, and the
 *  user-global root the bundled skills are installed into. Order is claude's own precedence
 *  (project first). `~/` is agy's home-relative form, resolved by agy — not by us, so the file
 *  stays portable across machines if a user does commit it. */
export const SKILL_ENTRY_PATHS = [".claude/skills", "~/.claude/skills"] as const;

// The merged config, or null for "do not write": the file is not ours to rewrite (not a JSON
// object, `entries` is not an array) or already carries every root (rewriting anyway would churn
// the file's mtime and formatting on every spawn for no change). Pure, so the "never lose a
// user's entry" rule is testable without a filesystem.
export function mergeAntigravitySkillsConfig(existing: unknown): Record<string, unknown> | null {
  if (!isRecord(existing)) return null;
  const raw = Object.prototype.hasOwnProperty.call(existing, "entries") ? existing.entries : [];
  if (!Array.isArray(raw)) return null;
  const entries: readonly unknown[] = raw;
  const present = new Set(entries.map((entry) => (isRecord(entry) && typeof entry.path === "string" ? entry.path : null)));
  const missing = SKILL_ENTRY_PATHS.filter((p) => !present.has(p));
  if (missing.length === 0) return null;
  return { ...existing, entries: [...entries, ...missing.map((p) => ({ path: p }))] };
}

// Kept out of the user's `git status` — see git-exclude.ts for why it is `.git/info/exclude`
// and not their `.gitignore`. Excluding has no effect on a skills.json a team already commits
// (exclude only hides untracked files), which is exactly the behaviour we want for both cases.
const EXCLUDE_ENTRY = `${CUSTOMIZATION_DIR}/skills.json`;

/** Point this directory's agy sessions at the skill roots. Idempotent, and quiet on failure: a
 *  read-only project is a reason for agy to have no skills there, not for the session to fail
 *  to start. */
export function syncAntigravitySkillsConfig(cwd: string): void {
  const file = antigravitySkillsConfigFile(cwd);
  // A checkout can COMMIT `.agents` or `skills.json` as a symlink to a file elsewhere, and the
  // reads/writes below all follow links — so a cloned repo could point this sync at a file of
  // the user's own and have it silently rewritten (symlink-guard.ts).
  if (!symlinkFreeWriteTarget(file)) return;
  let existing: unknown = {};
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return; // present but not JSON — someone else's file, and rewriting it would lose it
    }
  }
  const merged = mergeAntigravitySkillsConfig(existing);
  if (merged === null) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
    excludeFromGit(cwd, EXCLUDE_ENTRY);
  } catch (err) {
    console.warn(`[antigravity] could not write ${file}: ${err}`);
  }
}

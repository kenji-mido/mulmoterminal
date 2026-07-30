// The "tell me about this directory" routes: everything a terminal cell asks for once it
// knows its working dir. They share one shape — resolve `?cwd=`, then read something about
// that dir — and none of them touch session state, which is why they come out of index.ts
// first (#548 step 2). Dependencies are all already-extracted modules, so nothing is
// injected; the mount only needs the app.
import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { existingWorkspaceFromQuery } from "../config/workspace.js";
import { normalizeAgent, workspaceForRoute } from "./routeParams.js";
import { getHeaderConfig, getIssueWorkComments } from "../config/config-routes.js";
import { publicDirConfig, dirSoundFor, loadDirConfig, dirConfigDetail, MISSING_DIR_CONFIG_DETAIL } from "../config/dir-config.js";
import { readSoundPreset } from "../config/sound-presets.js";
import { isNotifyKind } from "../../common/notifyKinds.js";
import { buildHeaderContext, loadHeaderConfig, repoFromWebUrl } from "../config/header-context.js";
import { headerHasPrButton, resolveHeader } from "../config/header-resolve.js";
import { loadScripts } from "../files/scripts.js";
import { gitStatus } from "../git/git-status.js";
import { resolveGithubUrl } from "../git/gitRemote.js";
import { phaseForRepoBranch } from "../git/prPhase.js";
import { EMPTY_WORK_ITEM } from "../../common/prPhase.js";
import { ensureWorkComment } from "../git/work-comment.js";
import { workCommentDirLabel } from "../../common/workComment.js";
import { isRecord } from "../../common/isRecord.js";
import { prUrlForBranch } from "../git/pr-for-branch.js";
import { applySkillFilter, discoverSkills } from "../backends/remoteHost/skills.js";

// "This comment should exist on that issue" (#979 Phase 2). A POST, not a GET, because it writes
// on GitHub — and idempotent, because the caller is a poll: every tab re-asks on every tick, and
// ensureWorkComment collapses that to one comment.
//
// Opt-in: with the setting off it does nothing and says so, rather than 403 — the client asks
// blind, and a disabled feature is not an error.
async function workCommentHandler(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body ?? {};
  if (!isRecord(body)) {
    res.status(400).json({ error: "body must be an object" });
    return;
  }
  const kind = body.kind === "start" || body.kind === "merged" ? body.kind : null;
  const issue = positiveInt(body.issue);
  if (!kind || issue === null) {
    res.status(400).json({ error: "kind must be start|merged and issue a positive integer" });
    return;
  }
  if (!getIssueWorkComments()) {
    res.json({ posted: false, reason: "disabled" });
    return;
  }
  // No fallback to the default workspace here, unlike every read route: this one WRITES on
  // GitHub, and a request whose cwd is missing, relative, or names a directory that has since
  // been deleted would then comment on the workspace's repo instead — somebody else's issue
  // thread, from a stale or malformed request (Codex review).
  const cwd = existingWorkspaceFromQuery(body.cwd);
  if (!cwd) {
    res.json({ posted: false, reason: "no-cwd" });
    return;
  }
  const repo = repoFromWebUrl(await resolveGithubUrl(cwd));
  if (!repo) {
    res.json({ posted: false, reason: "no-repo" });
    return;
  }
  const result = await ensureWorkComment(repo, issue, kind, workCommentDirLabel(cwd), positiveInt(body.pr), { closeIssue: kind === "merged" });
  res.json(result);
}

async function prPhaseHandler(req: Request, res: Response): Promise<void> {
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  const status = await gitStatus(cwd);
  const repo = status.repo && status.branch ? repoFromWebUrl(await resolveGithubUrl(cwd)) : null;
  // The same shape as the resolved path, not a two-field subset: a dir with no GitHub remote
  // is a normal answer, and a route that changes its response shape by branch is a trap for
  // the next reader of the contract (Codex review).
  res.json(!repo || !status.branch ? { ...EMPTY_WORK_ITEM } : await phaseForRepoBranch(repo, status.branch));
}

const positiveInt = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

export function mountDirRoutes(app: Express): void {
  // GRID-ONLY (dev_tool): the `script.json` entries a cell's launcher offers for its
  // chosen directory (?cwd=<dir>, the default workspace when none is named). The browser shows
  // these and sends back only an INDEX + the cwd (see /ws/run), so the file is the
  // allowlist of what can run. The resolved `cwd` is returned so the cell runs the
  // script in the same dir it listed scripts for.
  app.get("/api/scripts", (req, res) => {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    res.json({ cwd, scripts: loadScripts(cwd).map((s, index) => ({ index, label: s.label, command: s.command, cwd: s.cwd })) });
  });

  // The `.claude/skills` (user + project scope) discoverable for ?cwd=<dir>, so the
  // terminal header's Skill menu can list them — working-dir skills first. Mirrors
  // /api/scripts: the picked skill is invoked in the running session by typing its
  // /<slug> (agent-side), so the browser only needs the slug + a description tooltip.
  // A per-dir `.mulmoterminal.json` `skills` allowlist narrows/orders the list;
  // absent => show all.
  app.get("/api/skills", async (req, res) => {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const skills = applySkillFilter(await discoverSkills({ workspaceRoot: cwd }), loadDirConfig(cwd).skills);
    res.json({ cwd, skills });
  });

  // Per-directory overrides (<cwd>/.mulmoterminal.json): the badge/name/theme a
  // terminal opened in this directory should use. cwd is validated like every other
  // cwd-scoped route; the raw sound path stays server-side (see /api/dir-sound).
  app.get("/api/dir-config", (req, res) => {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    res.json(publicDirConfig(cwd));
  });

  // The settings modal's preview: the same resolved config PLUS which keys the file set and
  // how each fared (applied / dropped in validation / not a key we read). Its own route rather
  // than fields on /api/dir-config, which every cell fetches — this re-reads the file and is
  // only wanted while the modal is open.
  // Answers about an unusable directory with the "unknown" payload rather than the 404 the
  // routes above give it: the settings modal renders that payload as "no config here", and it
  // asks about a directory the user is still typing.
  app.get("/api/dir-config-detail", (req, res) => {
    const cwd = existingWorkspaceFromQuery(req.query.cwd);
    res.json(cwd ? dirConfigDetail(cwd) : MISSING_DIR_CONFIG_DETAIL);
  });

  // Live git status (branch / dirty / ahead·behind) for a terminal's dir, so the
  // header can show it without the user typing `git status`. A non-git dir is
  // `repo:false`, not an error.
  app.get("/api/git-status", async (req, res) => {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    res.json(await gitStatus(cwd));
  });

  // GRID-ONLY: the workflow phase of a cell's branch — no PR yet / in the review loop / ready
  // to merge / merged (server/git/prPhase.ts). The cockpit roster shows it alongside the agent
  // status. Resolves the branch's repo here (same as the header's PR button); a non-repo dir,
  // detached HEAD, or non-GitHub remote yields `none`. Read-only; the gh call is cached.
  app.get("/api/pr-phase", prPhaseHandler);

  app.post("/api/work-comment", workCommentHandler);

  // The resolved terminal-header config (buttons + chips) for a session: global config merged with the
  // dir's, with `when` evaluated and ${vars} substituted for this session's live context. `chips:null`
  // means unconfigured, so the client keeps its default header (see plans/feat-header-toolbar-config.md).
  app.get("/api/header", async (req, res) => {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const session = typeof req.query.session === "string" && SESSION_ID_RE.test(req.query.session) ? req.query.session : null;
    const agent = normalizeAgent(req.query.agent);
    const model = typeof req.query.model === "string" ? req.query.model : null;
    const config = loadHeaderConfig(cwd, getHeaderConfig());
    const context = await buildHeaderContext(cwd, { session, agent, model });
    // Resolve the branch's PR URL only when a `pr` button is present (a cached gh call); an open.pr
    // button then opens that URL, or is dropped when there's no open PR.
    if (headerHasPrButton(config) && context.repo && context.branch) {
      context.prUrl = await prUrlForBranch(context.repo, context.branch);
    }
    res.json(resolveHeader(config, context));
  });

  // Stream a directory's custom attention sound. The path never comes from the
  // request — it's read from that dir's .mulmoterminal.json and confined to the dir —
  // so there's no traversal surface. 404 when unset/missing (the client falls back to
  // the global sound, then the built-in chime).
  app.get("/api/dir-sound", async (req, res) => {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    // An unknown/absent `kind` asks for the directory's all-kind sound, which is also what a
    // client from before #873 sends. The value only ever selects a map entry — never a path.
    const kind = isNotifyKind(req.query.kind) ? req.query.kind : null;
    const sound = dirSoundFor(cwd, kind);
    if (!sound) return res.status(404).end();
    if (sound.source === "preset") {
      const bytes = await readSoundPreset(sound.id);
      // 503, not 404: the id was validated when the directory config was read, so a miss is
      // the download failing — and the client retries a 5xx while it remembers a 404.
      return bytes ? res.type("audio/mpeg").send(bytes) : res.status(503).end();
    }
    // dotfiles:"allow" — the conventional location is a hidden <cwd>/.mulmoterminal/
    // dir, which send() would otherwise 404. The path is already confined to cwd, so
    // serving from a dot-segment is safe here.
    res.sendFile(sound.path, { dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}

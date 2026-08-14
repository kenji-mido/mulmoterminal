import type { Express } from "express";
import { requestOriginAllowed } from "../routes/same-origin-guard.js";
import type { SurvivingSession } from "../../common/survivingSessions.js";
import type { ReapSweepResult } from "../session/reap-idle-sessions.js";

// Deps injected from index.ts so the origin guard, session-id validation, and the
// orphan-selection boundary are unit-testable without booting the server (mirrors
// gitRemote / open-dir / command-summary).
export interface TmuxRouteDeps {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  isValidSessionId: (id: string) => boolean;
  // Reap a live session (kills its pty + tmux + cleanup); a no-op without a live entry.
  reapSession: (id: string) => void;
  hasTmux: (id: string) => boolean;
  killTmux: (id: string) => void;
  // Persist a user hide (hidden-store) / remove the session's transcripts (transcript-delete).
  // Injected like the rest so the hide/delete routes are unit-testable.
  hideSession: (id: string) => void;
  deleteTranscripts: (id: string) => boolean;
  // Run the same sweep the server runs at boot, and say what it did. The route used to carry the
  // decision itself, against a predicate made of permanent records — which is why it reaped almost
  // nothing (#1467). One rule now, in session/reap-idle-sessions.ts.
  sweep: () => ReapSweepResult;
  // Every surviving tmux session, annotated for the Settings list (#1478). Injected like the rest,
  // so the route is testable without tmux, a registry or a clock.
  survivingSessions: () => Promise<SurvivingSession[]>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// How long a delete waits for a killed session's tmux to actually be gone, and how long after
// that it sweeps once more. Both exist because the agent dies asynchronously — see the route.
const DELETE_TMUX_WAIT_TRIES = 20;
const DELETE_TMUX_WAIT_STEP_MS = 100;
const DELETE_STRAGGLER_SWEEP_MS = 2000;

export function mountTmuxRoutes(app: Express, deps: TmuxRouteDeps): void {
  // Explicit close (the cell's close button): reap NOW — kill the pty AND its tmux — instead of
  // leaving it for the disconnect grace. Works even when the WS is down, and kills a tmux
  // orphaned by a prior server restart (reap alone is a no-op without a live entry).
  app.post("/api/session/:id/terminate", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    deps.reapSession(id); // live entry → kills pty + tmux + cleanup
    if (deps.hasTmux(id)) deps.killTmux(id); // orphan (e.g. post-restart) → kill directly
    return res.json({ ok: true });
  });

  // Hide a session from the chat sidebar: persist the hide (so /api/sessions drops it), then
  // reap it like terminate — the user is done with it. The transcript is kept, so it stays
  // resumable via `claude --resume`; only the list entry goes away.
  app.post("/api/session/:id/hide", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    deps.hideSession(id);
    deps.reapSession(id);
    if (deps.hasTmux(id)) deps.killTmux(id);
    return res.json({ ok: true });
  });

  // Permanently delete a session: reap it, then remove its transcript so it's gone from the
  // list AND from `claude --resume`. Destructive and irreversible — the client gates this
  // behind a confirmation. (Hiding is the non-destructive path above.)
  app.post("/api/session/:id/delete", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    deps.reapSession(id);
    if (deps.hasTmux(id)) deps.killTmux(id);
    // A LIVE session's agent dies asynchronously and can flush one last transcript write
    // AFTER an immediate unlink — recreating the file and resurrecting the row, so the delete
    // "didn't work", sometimes. Wait (bounded) for the tmux session to actually be gone before
    // deleting, and sweep once more shortly after for a straggler flush that still slipped past.
    for (let waited = 0; deps.hasTmux(id) && waited < DELETE_TMUX_WAIT_TRIES; waited++) await delay(DELETE_TMUX_WAIT_STEP_MS);
    const removed = deps.deleteTranscripts(id);
    setTimeout(() => deps.deleteTranscripts(id), DELETE_STRAGGLER_SWEEP_MS);
    return res.json({ ok: true, removed });
  });

  // Every session that outlived the server, for the Settings list (#1478). A GET, and read-only:
  // what it shows is what the other two routes act on, which is why it is mounted beside them.
  //
  // The guard is asked exactly as its neighbours ask it, and — being a safe method — EXEMPT, the
  // same way google.ts's GET /status is (#1094): a cross-site `<img>` sends no Origin header and
  // neither does a legitimate local fetch, so refusing by origin would block the second without
  // stopping the first. What keeps this list private is that a cross-origin caller cannot READ the
  // reply; the rule lives in routes/same-origin-guard.ts.
  app.get("/api/tmux/sessions", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    return res.json({ sessions: await deps.survivingSessions() });
  });

  // The same sweep on demand: end every session nothing is using — nobody attached, no pty of
  // ours, no output for the configured number of days. The server runs it at boot; this is the way
  // to run it without restarting.
  app.post("/api/tmux/cleanup-orphans", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { reaped } = deps.sweep();
    // `killed` keeps its name: this route's answer is read by whatever anyone wired to it before.
    return res.json({ killed: reaped, killedCount: reaped.length });
  });
}

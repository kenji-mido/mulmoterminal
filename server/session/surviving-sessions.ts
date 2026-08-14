// Every tmux session this server can see, annotated with what it takes to decide its fate (#1478).
//
// The opposite selection from the phone's list (backends/remoteHost/terminalScreen.ts), which keeps
// only sessions that are resumable AND grid cells — a good rule for "what can I usefully open",
// and the reason a Shell left behind by a restart appears nowhere. This list starts from what tmux
// actually has and explains each one instead of filtering it away.
import { byClearability, type SurvivingSession } from "../../common/survivingSessions.js";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { tmuxAttachedCounts, tmuxListSessionIds, tmuxSessionActivity } from "../infra/tmux.js";
import { ptys, sessionCwd, devTerminalCwdsHydrated } from "./registry.js";
import { sessionAttached } from "./dir-session.js";
import { resumableSessionFacts } from "./resumable-sessions.js";
import { isRestorableSession, reapableTmuxSession } from "../infra/tmux.js";
import { reapIdleSeconds } from "../../common/sessionReap.js";
import { SESSION_ID_RE } from "../config/env.js";

/** The snapshots one listing takes, so the rule below is pure and the tmux calls happen once. */
export interface SurvivingInput {
  tmuxIds: readonly string[];
  /** Seconds since the epoch, per key; null when tmux could not say. */
  activity: Map<string, number> | null;
  /** The moment the list was taken, in epoch SECONDS — the unit tmux answers in. */
  nowSeconds: number;
  attached: (key: string) => boolean;
  /** On-disk evidence only — see the field's own note in common/survivingSessions.ts. */
  resumable: (key: string) => boolean;
  /** Whether the boot sweep would end it, from the same rule the sweep uses. */
  reapable: (key: string, idleSeconds: number | null) => boolean;
  /** Where it runs, live pty first; null when nothing remembers. */
  cwdOf: (key: string) => string | null;
  /** What runs in it, when that can be known at all. */
  agentOf: (key: string) => TerminalAgent | null;
}

/** Pure: snapshots in, the rows Settings draws out. The ordering is the product decision (see
 *  `byClearability`), so it is pinned here rather than left to whatever tmux happened to print. */
export function buildSurvivingSessions(input: SurvivingInput): SurvivingSession[] {
  return input.tmuxIds
    .map((key) => {
      const seen = input.activity?.get(key);
      // Clamped at zero: a clock that moved backwards between tmux's answer and ours would
      // otherwise report a session idle for negative time.
      const idleSeconds = seen === undefined ? null : Math.max(0, Math.round(input.nowSeconds - seen));
      return {
        key,
        cwd: input.cwdOf(key),
        agent: input.agentOf(key),
        idleSeconds,
        attached: input.attached(key),
        resumable: input.resumable(key),
        reapable: input.reapable(key, idleSeconds),
      };
    })
    .sort(byClearability);
}

/** What is running in this session, as far as anything here can tell. A live pty knows; otherwise
 *  the agent that wrote a conversation under this key does.
 *
 *  Null is the answer for a Shell or a launcher command — the rows listed nowhere else, which is
 *  the point — but ALSO for an agy, grok or muse session that outlived its pty: nothing here maps
 *  those back to a key, the same blind spot `isResumableTmuxSession` has (which is why such a row
 *  reads "not resumable" too). The UI says "shell or unknown" rather than naming a shell it cannot
 *  confirm. */
function agentOfKey(key: string, claudeOnDisk: ReadonlySet<string>, hasCodexRollout: (id: string) => boolean): TerminalAgent | null {
  const live = ptys.get(key);
  if (live && isTerminalAgent(live.agent)) return live.agent;
  if (claudeOnDisk.has(key)) return "claude";
  return hasCodexRollout(key) ? "codex" : null;
}

const SECONDS_PER_MS = 1000;

/** The live answer, for `GET /api/tmux/sessions`. */
export async function survivingSessions(nowMs: number, idleReapDays: number): Promise<SurvivingSession[]> {
  // The remembered directories are the only thing a session from a PREVIOUS run can be named by,
  // so a list taken before that file is read would show every survivor without one (#1021).
  await devTerminalCwdsHydrated;
  // One pass for both questions this list asks — is it resumable, and what wrote it. Asking them
  // separately walks ~/.claude/projects twice per listing for the same answer.
  const { claudeOnDisk, hasCodexRollout } = await resumableSessionFacts();
  const tmuxCounts = tmuxAttachedCounts();
  const idleThresholdSeconds = reapIdleSeconds(idleReapDays);
  return buildSurvivingSessions({
    tmuxIds: tmuxListSessionIds(),
    activity: tmuxSessionActivity(),
    nowSeconds: Math.floor(nowMs / SECONDS_PER_MS),
    attached: (key) => sessionAttached(key, tmuxCounts),
    // What ending it costs, and whether the server will end it — the same two rules the sweep and
    // the stop button are built on, so a row cannot promise one thing and the sweep do another.
    resumable: (key) => isRestorableSession(key, claudeOnDisk, hasCodexRollout),
    reapable: (key, idleSeconds) =>
      reapableTmuxSession({
        attachedCount: tmuxCounts === null ? null : (tmuxCounts.get(key) ?? 0),
        liveHere: ptys.has(key),
        idleSeconds,
        idleThresholdSeconds,
        validId: SESSION_ID_RE.test(key),
      }),
    // The live pty wins: it knows where the agent actually runs, and the remembered value can be a
    // directory the session was relaunched away from.
    cwdOf: (key) => ptys.get(key)?.cwd ?? sessionCwd(key),
    agentOf: (key) => agentOfKey(key, claudeOnDisk, hasCodexRollout),
  });
}

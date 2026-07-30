// The hidden Claude session that harvests the rate-limit windows (#387).
//
// It exists because the windows are only ever handed to a `statusLine` command, and only by an
// INTERACTIVE session that has had at least one API response — both measured. So the probe is a
// real `claude` PTY that is asked one trivial question, reports through the statusLine, and is
// killed. Nobody ever sees its terminal, which is what makes this cheaper than #388's design: that
// one injected the statusLine into the user's own cells and cost each of them a row.
//
// What it costs instead is one small query against the very budget it reports. That is the whole
// reason the caller only asks when a browser is watching (see rate-limit-store.ts) — a probe on a
// timer would spend the user's window overnight to refresh a number nobody is reading.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { statusLineCommand } from "./statusline.js";

// Long enough for a cold `claude` to boot, answer, and re-render its status line; short enough
// that a probe which will never report (no binary, an unaccepted trust prompt, an expired login)
// gives up rather than holding a PTY open.
export const PROBE_TIMEOUT_MS = 90_000;

// The question. Anything answerable without tools, because the point is to cause ONE API response
// — the cheapest thing that makes `rate_limits` appear.
//
// Exported because it is also the only thing that identifies a transcript written by a probe that
// predates `--session-id` (#1010). Change it and those become unrecognisable — which is a reason
// to leave it alone, not a reason to keep the two copies in sync.
export const PROBE_PROMPT = "reply with the single character: .";

export interface ProbePty {
  write(data: string): void;
  kill(): void;
}

export interface ProbeDeps {
  // Injected so a test can drive the lifecycle without a real terminal.
  spawn: (args: string[], cwd: string) => ProbePty;
  host: string;
  port: string | number;
  cwd: string;
  sessionId: string;
  onSettled: () => void;
  // The byte(s) that submit on THIS host, read when the probe submits (`terminalSubmit`). The
  // probe drives a real `claude` TUI, so on an `esc-cr` host a bare CR is the NEWLINE: hardcoding
  // it left the question typed but never asked, and the probe could only time out — the gauge then
  // never refreshes, with nothing on screen to say why (#1148).
  submitSequence: () => string;
}

/**
 * Start one probe. Returns a stop function, called both by the timeout and by the report arriving.
 *
 * Failure has no branch of its own HERE on purpose: a trust prompt nobody answered, a login that
 * expired, a machine too slow to boot the TUI — all of them look the same from inside one probe
 * (no report before the timeout), and all of them want the same response, which is to stop and
 * leave the gauge showing what it had.
 *
 * Telling them apart is the CALLER's job, and it matters: `claude` missing is decided before this
 * runs (a PATH lookup, not a spawn), and "a status line arrived carrying no windows" is decided by
 * the report route. Both used to arrive here as the same silence, which is how a failing probe
 * re-fired every 90 seconds forever (#1011).
 */
export function startRateLimitProbe(deps: ProbeDeps): () => void {
  // Setup is inside the guard, not before it. It reaches the disk — a full or read-only tmp throws
  // — and the caller has ALREADY marked a probe in flight by the time this runs. An escape here
  // would leave that flag set with nothing to clear it, so the gauge would stop refreshing for the
  // life of the process. Every failure has to arrive as "this probe reported nothing".
  let settings: { dir: string; file: string };
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-"));
    const file = path.join(dir, "settings.json");
    writeFileSync(file, JSON.stringify({ statusLine: { type: "command", command: statusLineCommand(deps.host, deps.port) } }), {
      mode: 0o600,
    });
    settings = { dir, file };
  } catch {
    deps.onSettled();
    return () => {};
  }
  const { dir, file: settingsFile } = settings;

  let stopped = false;
  let pty: ProbePty | null = null;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      pty?.kill();
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
    deps.onSettled();
  };
  const timer = setTimeout(stop, PROBE_TIMEOUT_MS);

  try {
    // `--session-id` so the transcript claude writes has an id WE chose. Without it claude mints
    // its own, and a session nobody asked for lands in /api/sessions and `claude --resume` with
    // nothing to identify it by (#1010). The caller registers the same id as an internal helper,
    // which is what keeps it out of the listing.
    pty = deps.spawn(["--session-id", deps.sessionId, "--permission-mode", "auto", "--settings", settingsFile], deps.cwd);
    // The prompt has to arrive after the TUI is listening; there is no readiness signal to wait
    // for that is worth parsing, and sending early costs only this probe.
    setTimeout(() => {
      // Guarded like kill() is: the PTY may have exited between the timer being set and it firing,
      // and a throw here lands in a bare timer callback where there is nobody to catch it.
      try {
        if (stopped) return;
        pty?.write(PROBE_PROMPT);
        setTimeout(() => {
          try {
            if (!stopped) pty?.write(deps.submitSequence());
          } catch {
            stop();
          }
        }, TYPE_TO_SUBMIT_MS);
      } catch {
        stop();
      }
    }, BOOT_MS);
  } catch {
    // `claude` is not installed, or cannot be launched at all. Same outcome as any other failure.
    stop();
  }
  return stop;
}

// The TUI paints before it accepts input, and text typed into a still-booting one is lost.
const BOOT_MS = 4000;
// Enter sent in the same breath as the text can land before the input box has it.
const TYPE_TO_SUBMIT_MS = 800;

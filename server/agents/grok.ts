import type { AgentAdapter } from "./types.js";

// Draft injection isn't wired for grok yet, so it omits draftReadyMarker — the marker has to be
// read off a real grok TUI, and a guessed one silently types into nothing.
export const grokAdapter = {
  kind: "grok",
  bin: () => process.env.GROK_BIN || "grok",
  binEnvVar: "GROK_BIN",
} satisfies AgentAdapter;

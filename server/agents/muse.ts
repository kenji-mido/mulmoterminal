import type { AgentAdapter } from "./types.js";

export const museAdapter = {
  kind: "muse",
  bin: () => process.env.MUSE_BIN || "muse",
  binEnvVar: "MUSE_BIN",
} satisfies AgentAdapter;

// Builds the argv for spawning grok as a first-class session.
//
// grok is CLAUDE-shaped here, not codex-shaped: `--session-id <UUID>` starts a new conversation
// under an id WE choose, so there is no rollout file to watch and no minted id to discover after
// the fact. That is why there is no grok counterpart to codex-session.ts's watcher.
//
// The two id flags are mutually exclusive, and this is the reason it is enforced rather than left
// to the caller: grok accepts `--session-id` with `--resume` only alongside `--fork-session`, where
// it NAMES THE FORK. A reconnect that sent both would therefore not resume the conversation — it
// would branch it, leaving the original behind under the old id.
//
// Measured against grok 0.2.118: re-using a `--session-id` that already exists fails loudly
// ("Session ID … is already in use") rather than silently starting fresh, so the exclusivity below
// is about correctness of the resume, not about avoiding a silent overwrite.

export interface GrokArgsInput {
  /** The id this server minted, for a FRESH session. Ignored when `resume` is set. */
  sessionId: string;
  /** A grok conversation id to resume, or null to start fresh under `sessionId`. */
  resume: string | null;
  /** Model override (--model), or null to use grok's own configured default. */
  model?: string | null;
  /** Auto-approve tool permission requests, the counterpart of claude's `--permission-mode auto`.
   *  grok spells it `--permission-mode auto`; `--always-approve` is the wider hammer and is not
   *  what the other agents are given. */
  skipPermissions?: boolean;
  /** A first turn to run on startup, for a session spawned to DO something (a collection action, a
   *  background chat). grok takes it as a positional argument and stays interactive afterwards. */
  initialPrompt?: string | null;
}

export function buildGrokArgs(input: GrokArgsInput): string[] {
  const args: string[] = [];

  // Exactly one of the two, never both — see the header.
  if (input.resume) {
    args.push("--resume", input.resume);
  } else {
    args.push("--session-id", input.sessionId);
  }

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.skipPermissions) {
    args.push("--permission-mode", "auto");
  }

  // Last, and positional: anything appended after it would be read as part of the prompt.
  if (input.initialPrompt) {
    args.push(input.initialPrompt);
  }

  return args;
}

// Builds the argv for spawning `muse` as a first-class session.
//
// `muse` is codex-shaped on the id axis: there is no `--session-id`, it mints its own (a row in
// `session-index.db`), so a fresh spawn is watched for the new row and a resume names it —
// `muse resume <uuid>`.
//
// Everything else is a ROOT option, and muse accepts those on either side of the subcommand
// (`muse resume --help` says so). That is what makes the resume path below carry `--workspace`
// rather than dropping it: `--workspace <PATH>` is what registers the policy-gated workspace tools,
// so a resumed session started without it comes back with the conversation and without the tools
// it had — file edits and shell in the project it was working on. The flags are emitted BEFORE the
// subcommand, which is the form the CLI documents first.
//
// `--yolo` disables approval prompts and the sandbox for the run. It is the counterpart of the
// `--permission-mode auto` grok is given and the permission mode claude cells run under: a cell in
// the grid has no way to answer a modal approval prompt in a TUI it is not being watched.

export interface MuseArgsInput {
  /** A muse session id to resume, or null to start fresh in `workspace`. */
  resume?: string | null;
  /** The directory whose tools the session is given (--workspace). Passed on BOTH paths. */
  workspace?: string | null;
  /** Model override (--model), or null to use muse's own configured default. */
  model?: string | null;
  /** `none|minimal|low|medium|high|xhigh|ultra`, or null for muse's default. */
  reasoningEffort?: string | null;
  /** A first turn to run on startup, for a session spawned to DO something (a background chat).
   *  muse takes it as a positional argument and stays interactive afterwards.
   *
   *  Ignored on a RESUME, and it has to be: the positional prompt belongs to the no-subcommand
   *  form, and `muse resume <id> <prompt>` is not a command line muse accepts. A resumed session
   *  is seeded by typing into it, not by argv. */
  initialPrompt?: string | null;
}

export function buildMuseArgs(input: MuseArgsInput): string[] {
  const args: string[] = ["--yolo"];

  if (input.workspace) args.push("--workspace", input.workspace);
  if (input.model) args.push("--model", input.model);
  if (input.reasoningEffort) args.push("--reasoning-effort", input.reasoningEffort);

  if (input.resume) {
    args.push("resume", input.resume);
    return args;
  }

  // Last, and positional: anything appended after it would be read as part of the prompt.
  if (input.initialPrompt) args.push(input.initialPrompt);

  return args;
}

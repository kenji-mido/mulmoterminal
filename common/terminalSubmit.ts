// How the host's Claude Code / TUI maps received bytes to "submit this prompt" vs
// "insert a newline". The TUI decides from the bytes, and that mapping is environment-
// dependent (Claude Code lets a user rebind it), so the SAME fact has to reach two
// unrelated places: the browser's xterm key handler and the phone remote-view's submit.
// One value, consumed by both, keeps them from drifting apart.
//
//   "cr"      — the standard binding: CR (\r) submits, ESC+CR (\x1b\r, = Alt/Meta+Enter)
//               makes a newline. This is MulmoTerminal's default and unchanged behaviour.
//   "esc-cr"  — the reversed binding some users configure: ESC+CR submits, CR makes a
//               newline.
export const TERMINAL_SUBMIT_MODES = ["cr", "esc-cr"] as const;
export type TerminalSubmitMode = (typeof TERMINAL_SUBMIT_MODES)[number];
export const DEFAULT_TERMINAL_SUBMIT_MODE: TerminalSubmitMode = "cr";

export const isTerminalSubmitMode = (value: unknown): value is TerminalSubmitMode =>
  typeof value === "string" && (TERMINAL_SUBMIT_MODES as readonly string[]).includes(value);

// CR on its own. ESC+CR is what a terminal emits for Alt/Meta+Enter.
const CR = "\r";
const ESC_CR = "\x1b\r";

// The byte(s) the host reads as "submit this prompt" in the given mode.
export const submitSequence = (mode: TerminalSubmitMode): string => (mode === "esc-cr" ? ESC_CR : CR);
// The byte(s) it reads as "insert a newline" — the other one.
export const newlineSequence = (mode: TerminalSubmitMode): string => (mode === "esc-cr" ? CR : ESC_CR);

// The submit byte(s) for a specific session. `terminalSubmit` describes the user's CLAUDE
// binding, so it applies ONLY to Claude sessions; every other agent (shell, codex, a
// one-shot command) keeps plain CR — a reversed setting must never rewrite a shell's Enter,
// where ESC+CR is Alt+Enter, not submit.
export const submitSequenceForAgent = (agent: string | undefined, mode: TerminalSubmitMode): string => (agent === "claude" ? submitSequence(mode) : CR);

// Text we are about to submit ON the user's behalf, ended so Claude Code has no completion menu
// open when the submit byte(s) arrive.
//
// Claude Code holds a completion menu open while the cursor sits at the end of a completion token
// — a `/command` or an `@path` — and an open menu consumes the key that should have submitted.
// Measured against Claude Code 2.1.220:
//
//   `/help` + CR        submits          (the one case that always worked)
//   `/help` + ESC CR    does NOT submit  — the menu's own `escape` binding eats the ESC, so the
//                                          "esc-cr" submit never lands, however often it is sent
//   `@path` + CR        does NOT submit  — the file picker takes that CR for itself
//   either + a trailing space            submits: the space ends the token, closing the menu
//
// So this is NOT specific to the reversed submit mapping (#1142 was reported there, but the
// `@path` half hits the default mapping too), and it is deliberately not a list of Claude Code's
// trigger characters: a trigger we failed to enumerate would silently restore a dead end that
// looks like a broken feature.
//
// For auto-submitted text only. A draft the user still edits keeps exactly what was handed over —
// their own Enter is a keystroke they can retry once they see the menu.
export const submittableLine = (text: string): string => (/\S$/.test(text) ? `${text} ` : text);

// The same Claude-only scoping as submitSequenceForAgent, and for a sharper reason: the completion
// menu is Claude Code's behaviour, while for every other target the trailing space would be REAL
// input. A shell line ending in `\` escapes the newline and waits for more (`echo foo\` → a
// continuation prompt); with a space appended it is an escaped space and runs instead. So a
// shell/codex/command session's bytes stay exactly what the sender wrote.
export const submittableLineForAgent = (agent: string | undefined, text: string): string => (agent === "claude" ? submittableLine(text) : text);

// The structural shape of a keydown the override needs. A real DOM KeyboardEvent satisfies
// it, and so does a plain test object — no DOM dependency, so this stays testable and shared.
export interface EnterKeyEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

// The bytes to emit for an Enter-family keydown (the caller then suppresses xterm's own
// \r and sends these instead), or null to let xterm handle the key natively.
//
// The SEMANTICS are the same in both modes — a bare Enter SUBMITS, Shift/Alt(Option)+Enter
// make a NEWLINE — only which bytes carry each meaning differs, because that is the
// environment fact `mode` encodes.
//
// In "cr" mode only Shift+Enter is overridden, exactly as before the setting existed: a
// bare Enter falls through to xterm's native \r (submit) and Option+Enter to
// macOptionIsMeta's ESC+CR (newline). Leaving the bare-Enter path native keeps IME
// candidate-confirm and the hottest key untouched in the default configuration.
export const enterKeyOverride = (mode: TerminalSubmitMode, e: EnterKeyEvent): string | null => {
  if (e.type !== "keydown" || e.key !== "Enter") return null;
  // IME composition (Japanese and other CJK input): this Enter confirms a candidate — it
  // is never the user's submit/newline, so never intercept it.
  if (e.isComposing) return null;
  const bare = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  const shiftOnly = e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  const altHeld = e.altKey && !e.ctrlKey && !e.metaKey; // Option/Alt (with or without Shift)
  if (mode === "cr") return shiftOnly ? newlineSequence(mode) : null;
  // "esc-cr": a bare Enter must emit the ESC+CR that submits here; Shift/Alt+Enter must
  // emit the CR that makes a newline (the Alt case also overrides macOptionIsMeta's ESC+CR).
  if (bare) return submitSequence(mode);
  if (shiftOnly || altHeld) return newlineSequence(mode);
  return null;
};

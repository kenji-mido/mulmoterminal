// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SESSION_SUMMARY_PROMPT } from "../../../server/agents/session-summary-prompt.js";

// #942. The prompt is prose, so these pin the properties an edit could quietly break — not the
// wording. What it must keep saying is in the module's own comment; what it must not become is
// here.
describe("SESSION_SUMMARY_PROMPT", () => {
  // It rides in the argv of every spawn and is paid on every request to the model. The seed
  // prompt was moved out of the argv at ~20KB (tmux "command too long"); this is the ceiling
  // that keeps it an order of magnitude clear of that, and keeps the per-turn cost small.
  const MAX_PROMPT_BYTES = 4096;

  it("stays small enough to ride in the argv on every spawn", () => {
    expect(Buffer.byteLength(SESSION_SUMMARY_PROMPT, "utf8")).toBeLessThan(MAX_PROMPT_BYTES);
    expect(SESSION_SUMMARY_PROMPT.trim().length).toBeGreaterThan(0);
  });

  // "Never use emojis anywhere in this project" — and this one is doubly bad, because the text
  // is an instruction the model imitates.
  it("carries no emoji", () => {
    expect(SESSION_SUMMARY_PROMPT).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  // It is passed as a single execve argument, not through a shell. A NUL truncates it and a
  // trailing newline is invisible in a diff — both are silent, so assert instead of trusting.
  it("survives as one argv value", () => {
    expect(SESSION_SUMMARY_PROMPT).not.toContain("\0");
    expect(SESSION_SUMMARY_PROMPT).toBe(SESSION_SUMMARY_PROMPT.trim());
  });

  // The Windows argv invariant (#813): the JSON payloads were moved to files precisely so that
  // nothing claude is launched with carries a quote for a `.cmd` parser to trip over, and this
  // prompt now rides in that same argv. session-settings.spec asserts the property over a whole
  // spawn, which is the real guard — but it names the argv, not the sentence that broke it. This
  // one fails where the wording is edited. Typographic quotes are not parser-significant and
  // stay allowed.
  it("carries no ASCII double quote, which a Windows spawn's argv must not contain", () => {
    expect(SESSION_SUMMARY_PROMPT).not.toContain('"');
  });
});

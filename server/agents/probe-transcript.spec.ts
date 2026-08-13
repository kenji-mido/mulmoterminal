// @vitest-environment node
// Nothing here touches a DOM — it is fs and this module's predicates — and the default jsdom
// environment cost this file 624ms of setup per run for nothing (2.24s -> 1.06s without it).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import os from "node:os";
import {
  isProbeTranscript,
  removeProbeTranscript,
  sweepLegacyProbeTranscripts,
  sweepLegacyProbeTranscriptsOnce,
  probeSweepMarker,
  PROBE_TRANSCRIPT_MAX_BYTES,
} from "./probe-transcript";
import { PROBE_PROMPT } from "./rate-limit-probe";
import { newProbeSessionId, PROBE_SESSION_PREFIX } from "./probe-session";
import { projectSessionsDir } from "../session/project-dir";

// #1010: these functions DELETE files out of the user's ~/.claude. The predicate is the whole
// safety argument, so it is pinned here rather than tried out on a real disk.

const userLine = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const userBlocks = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistantLine = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const toolUseLine = () => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } });
const noise = () => JSON.stringify({ type: "attachment", foo: 1 });
const probe = () => [noise(), userLine(PROBE_PROMPT), assistantLine("."), noise()].join("\n");

describe("isProbeTranscript", () => {
  it("recognises a probe: one user message, and it is the prompt", () => {
    expect(isProbeTranscript(probe())).toBe(true);
  });

  it("recognises it when the content is text blocks rather than a bare string", () => {
    expect(isProbeTranscript([userBlocks(PROBE_PROMPT), assistantLine(".")].join("\n"))).toBe(true);
  });

  // The measured failure mode: over 7711 transcripts a substring test matched 6 real
  // conversations, one of them 974 messages long — it had merely DISCUSSED the prompt.
  it("does not claim a real conversation that merely quotes the prompt", () => {
    const real = [userLine("what does this do?"), assistantLine(`it sends ${PROBE_PROMPT} to claude`), userLine(PROBE_PROMPT), userLine("thanks")].join("\n");
    expect(real).toContain(PROBE_PROMPT);
    expect(isProbeTranscript(real)).toBe(false);
  });

  // Codex review on #1030: a person CAN type the probe's exact words. No field separates the two —
  // the probe types into the real TUI. What can be said is that a probe never reaches for a tool,
  // which held for all 84 probe transcripts measured.
  it("spares a one-turn conversation that used a tool, however it opened", () => {
    expect(isProbeTranscript([userLine(PROBE_PROMPT), toolUseLine(), assistantLine(".")].join("\n"))).toBe(false);
  });

  it("does not claim a session whose single message is something else", () => {
    expect(isProbeTranscript(userLine("reply with the single character: x"))).toBe(false);
    expect(isProbeTranscript(userLine(`${PROBE_PROMPT} and then explain`))).toBe(false);
  });

  it("does not claim a transcript with no user message at all", () => {
    expect(isProbeTranscript([noise(), assistantLine(".")].join("\n"))).toBe(false);
    expect(isProbeTranscript("")).toBe(false);
  });

  it("survives a truncated last line, which a file still being written always has", () => {
    expect(isProbeTranscript([userLine(PROBE_PROMPT), '{"type":"assis'].join("\n"))).toBe(true);
  });
});

// The disk-touching half runs against a fake HOME so no real transcript is ever in reach.
describe("probe transcript removal", () => {
  const realHome = os.homedir();
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "mt-probe-home-"));
    Object.defineProperty(os, "homedir", { value: () => home, configurable: true });
    // Under the sandbox home too, so nothing here names a world-writable path.
    cwd = path.join(home, "project");
    mkdirSync(projectSessionsDir(cwd), { recursive: true });
  });

  afterEach(() => {
    Object.defineProperty(os, "homedir", { value: () => realHome, configurable: true });
    rmSync(home, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => writeFileSync(path.join(projectSessionsDir(cwd), name), body);
  const remains = () => readdirSync(projectSessionsDir(cwd)).sort();

  it("removes the probe's own transcript by id, and leaves every other id alone", async () => {
    const mine = newProbeSessionId();
    const theirs = newProbeSessionId();
    write(`${mine}.jsonl`, userLine(PROBE_PROMPT));
    write(`${theirs}.jsonl`, userLine(PROBE_PROMPT));

    expect(await removeProbeTranscript(cwd, mine)).toBe(true);
    expect(remains()).toEqual([`${theirs}.jsonl`]);
  });

  // A future caller passing the wrong variable must not be able to delete somebody's session.
  it("refuses an id that is not shaped like a probe's, even if the file is there", async () => {
    write("3f2504e0-4f89-41d3-9a0c-0305e82c3301.jsonl", userLine(PROBE_PROMPT));

    expect(await removeProbeTranscript(cwd, "3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(false);
    expect(remains()).toEqual(["3f2504e0-4f89-41d3-9a0c-0305e82c3301.jsonl"]);
  });

  // Codex review on #1030: the id is joined into a path, so an id that only STARTS like a probe's
  // could name a file anywhere. Pinned here as well as in probe-session.spec.ts, because this is
  // the call that deletes — the two must not drift apart.
  it("cannot be walked out of the sessions directory", async () => {
    const outside = path.join(home, "precious.jsonl");
    writeFileSync(outside, "someone's work");
    // The first `..` fuses with the prefix into one literal segment that DESCENDS a level, so the
    // climb needs two extra to break even. Asserted rather than assumed: an escape that falls
    // short still deletes nothing, and the test would pass for the wrong reason.
    const climb = path.relative(projectSessionsDir(cwd), outside).replaceAll(path.sep, "/");
    const escape = `${PROBE_SESSION_PREFIX}../../${climb}`.replace(/\.jsonl$/, "");
    expect(path.join(projectSessionsDir(cwd), `${escape}.jsonl`)).toBe(outside);

    expect(await removeProbeTranscript(cwd, escape)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("says so rather than throwing when there is nothing to remove", async () => {
    expect(await removeProbeTranscript(cwd, newProbeSessionId())).toBe(false);
  });

  it("sweeps legacy probes and spares real work in the same directory", async () => {
    write("legacy-probe-a.jsonl", probe());
    write("legacy-probe-b.jsonl", [userBlocks(PROBE_PROMPT), assistantLine(".")].join("\n"));
    write("real-conversation.jsonl", [userLine("about " + PROBE_PROMPT), userLine("more")].join("\n"));
    write("unrelated.jsonl", userLine("hello"));
    write("not-a-transcript.txt", PROBE_PROMPT);

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(2);
    expect(remains()).toEqual(["not-a-transcript.txt", "real-conversation.jsonl", "unrelated.jsonl"]);
  });

  // Reading a 14MB conversation to decide it is not a 90KB probe is pure waste, and erring high
  // can only leave litter behind.
  it("does not even read a file far larger than any probe", async () => {
    write("huge.jsonl", userLine(PROBE_PROMPT) + "\n" + "x".repeat(PROBE_TRANSCRIPT_MAX_BYTES));

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(0);
    expect(remains()).toEqual(["huge.jsonl"]);
  });

  it("does nothing, quietly, when the project has no transcripts yet", async () => {
    expect(await sweepLegacyProbeTranscripts(path.join(home, "never-used"))).toBe(0);
  });

  // Observed during Claude review, not flagged by a bot. This directory holds 454 files on the
  // machine this was written on, and opening them all at once exhausts the file-descriptor limit:
  // measured at `ulimit -n 128`, reading 600 files with Promise.all died with EMFILE having read
  // NONE, while one-at-a-time read all 600. It matters more here than elsewhere because the sweep
  // gets ONE run — a file skipped by an EMFILE is one nothing ever comes back for.
  //
  // This test covers the count, not the limit: it cannot lower `ulimit` for its own process, so on
  // a machine with a high one it would pass either way. The measurement above is the evidence.
  // A per-test timeout, not the 15s baseline. This test writes 601 files and the sweep reads all
  // 601 back, and that 1200-operation floor is REAL disk rather than work this process controls:
  // alone it costs 271ms (setup 60ms, sweep 208ms — 0.35ms/file, so the sweep itself is not slow),
  // but under the full suite ~19 workers share one disk and the same test took 5.4s and 9.7s on
  // two samples. A CI runner with a slower disk goes further still, and what it would report is a
  // timeout — which reads as "the sweep broke" rather than "the machine was busy" (#1328). Kept at
  // 601 deliberately: the count is the claim this test makes. A real hang still trips this.
  it("gets through a directory of many transcripts", async () => {
    const count = 600;
    for (let i = 0; i < count; i++) write(`probe-${i}.jsonl`, probe());
    write("real.jsonl", [userLine("mine"), userLine("also mine")].join("\n"));

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(count);
    expect(remains()).toEqual(["real.jsonl"]);
  }, 60_000);

  it("only looks inside the project it was given", async () => {
    const other = path.join(home, "other-project");
    mkdirSync(projectSessionsDir(other), { recursive: true });
    writeFileSync(path.join(projectSessionsDir(other), "probe.jsonl"), probe());
    write("probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(1);
    expect(existsSync(path.join(projectSessionsDir(other), "probe.jsonl"))).toBe(true);
  });
});

// The time bound is the real answer to "a person could type the same thing" (Codex on #1030):
// the sweep is for files that predate the fix, so it gets exactly one chance.
describe("the one-time sweep", () => {
  const realHome = os.homedir();
  let home: string;
  let cwd: string;
  let stateDir: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "mt-probe-once-"));
    Object.defineProperty(os, "homedir", { value: () => home, configurable: true });
    cwd = path.join(home, "project");
    stateDir = path.join(home, "state");
    mkdirSync(projectSessionsDir(cwd), { recursive: true });
  });

  afterEach(() => {
    Object.defineProperty(os, "homedir", { value: () => realHome, configurable: true });
    rmSync(home, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => writeFileSync(path.join(projectSessionsDir(cwd), name), body);

  it("sweeps the first time and records that it did", async () => {
    write("old-probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBe(1);
    expect(existsSync(probeSweepMarker(stateDir, cwd))).toBe(true);
  });

  it("never touches a transcript typed after that, however identical it looks", async () => {
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBe(0);
    // Someone types the probe's exact words, by hand, the next day.
    write("a-person-typed-this.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBeNull();
    expect(existsSync(path.join(projectSessionsDir(cwd), "a-person-typed-this.jsonl"))).toBe(true);
  });

  it("records the sweep even when it found nothing, so the right to delete is not re-earned", async () => {
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBe(0);
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBeNull();
  });

  // Codex review on #1030: several checkouts run side by side against one ~/.mulmoterminal, so two
  // servers can start together. `stat` then write would let BOTH see no marker and both sweep,
  // reopening the repeated-deletion window the marker exists to close.
  it("lets only one of several simultaneous starts claim the sweep", async () => {
    write("old-probe.jsonl", probe());

    const contenders = await Promise.all(Array.from({ length: 5 }, () => sweepLegacyProbeTranscriptsOnce(cwd, stateDir)));

    expect(contenders.filter((r) => r !== null)).toHaveLength(1);
    expect(contenders.filter((r) => r === null)).toHaveLength(4);
    expect(existsSync(path.join(projectSessionsDir(cwd), "old-probe.jsonl"))).toBe(false);
  });

  // Codex review on #1030: a fresh install has no ~/.mulmoterminal yet. Writing the marker into a
  // directory that does not exist throws, the caller can only swallow it, and the sweep would then
  // delete on EVERY boot — the permanent window this design exists to close.
  it("creates the marker's directory, so a fresh install still only sweeps once", async () => {
    const unmade = path.join(home, "not-created-yet");
    write("old-probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, unmade)).toBe(1);
    expect(existsSync(probeSweepMarker(unmade, cwd))).toBe(true);

    write("a-person-typed-this.jsonl", probe());
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, unmade)).toBeNull();
    expect(existsSync(path.join(projectSessionsDir(cwd), "a-person-typed-this.jsonl"))).toBe(true);
  });

  // Claimed before anything is deleted: if the claim cannot be written, the safe answer is to
  // delete nothing rather than to delete and forget having done so.
  it("deletes nothing when it cannot record that it swept", async () => {
    // A state dir whose own parent is a FILE can never be created.
    writeFileSync(path.join(home, "blocker"), "not a directory");
    const blocked = path.join(home, "blocker", "state");
    write("old-probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, blocked)).toBeNull();
    expect(existsSync(path.join(projectSessionsDir(cwd), "old-probe.jsonl"))).toBe(true);
  });

  // Observed during Claude review, not flagged by a bot. The sweep's scope is ONE project
  // directory, so the record of having swept has to be per directory too. A single machine-wide
  // marker would let the first CLAUDE_CWD claim it and leave a second one holding its legacy
  // probes forever — half of #1010, and silently.
  it("sweeps each workspace once, not the machine once", async () => {
    const other = path.join(home, "other-workspace");
    mkdirSync(projectSessionsDir(other), { recursive: true });
    write("old-probe.jsonl", probe());
    writeFileSync(path.join(projectSessionsDir(other), "old-probe.jsonl"), probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBe(1);
    expect(await sweepLegacyProbeTranscriptsOnce(other, stateDir)).toBe(1);
    expect(existsSync(path.join(projectSessionsDir(other), "old-probe.jsonl"))).toBe(false);

    // …and still only once each.
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, stateDir)).toBeNull();
    expect(await sweepLegacyProbeTranscriptsOnce(other, stateDir)).toBeNull();
  });
});

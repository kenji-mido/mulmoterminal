import { describe, it, expect } from "vitest";
import { appendBoundedOutput, PrivateModeTracker, recordPtyOutput, stripTerminalQueries } from "../../../server/session/terminal-replay.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripTerminalQueries", () => {
  it("removes a Device Attributes query embedded in output (the 0;276;0c symptom source)", () => {
    expect(stripTerminalQueries(`abc${ESC}[>c def`)).toBe("abc def");
    expect(stripTerminalQueries(`${ESC}[c`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>0c`)).toBe("");
  });

  it("removes device/cursor status queries", () => {
    expect(stripTerminalQueries(`${ESC}[6n`)).toBe("");
    expect(stripTerminalQueries(`x${ESC}[5ny`)).toBe("xy");
    expect(stripTerminalQueries(`${ESC}[?6n`)).toBe("");
  });

  it("removes kitty-keyboard and XTVERSION queries", () => {
    expect(stripTerminalQueries(`${ESC}[?u`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>q`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>0q`)).toBe("");
  });

  it("removes OSC color queries (BEL- or ST-terminated)", () => {
    expect(stripTerminalQueries(`${ESC}]10;?${BEL}`)).toBe("");
    expect(stripTerminalQueries(`${ESC}]11;?${ESC}\\`)).toBe("");
  });

  it("does NOT strip a DA RESPONSE (multi-param) — only queries", () => {
    const response = `${ESC}[>0;276;0c`;
    expect(stripTerminalQueries(response)).toBe(response);
  });

  it("leaves visible text and SGR colour sequences untouched", () => {
    const styled = `${ESC}[31mhello${ESC}[0m world`;
    expect(stripTerminalQueries(styled)).toBe(styled);
    expect(stripTerminalQueries("plain text")).toBe("plain text");
  });
});

describe("appendBoundedOutput", () => {
  it("appends verbatim while under the limit", () => {
    expect(appendBoundedOutput("abc", "def", 100)).toBe("abcdef");
    expect(appendBoundedOutput("", "", 100)).toBe("");
  });

  it("keeps the tail once the limit is exceeded", () => {
    // Exactly at the limit is still verbatim — only a genuine overflow trims.
    expect(appendBoundedOutput("abcde", "", 5)).toBe("abcde");
    expect(appendBoundedOutput("abc\ndef", "ghi", 6)).toBe("defghi");
  });

  // The #434 regression: a cut inside an SGR left "5;196m" rendering as literal text.
  // Worst case — the tail has no newline and no later ESC to resume from.
  it("drops a leading sequence remnant when there is no boundary to resume from", () => {
    const stream = "x".repeat(50) + `${ESC}[38;5;196m` + "RED";
    expect(appendBoundedOutput(stream, "", 9)).toBe("RED"); // was "5;196mRED"
  });

  // A clean cut must keep EVERY retained byte. An earlier version resumed at the next
  // newline or ESC, silently discarding the head of the tail even when nothing was split.
  it("keeps the whole tail when the cut falls between sequences", () => {
    expect(appendBoundedOutput("zzzhello world", "", 11)).toBe("hello world");
    expect(appendBoundedOutput("y".repeat(200), "", 10)).toBe("y".repeat(10));
    // Including a leading newline: it is a real byte of the retained tail, not a boundary
    // to skip past.
    expect(appendBoundedOutput(`aaa\nbbb${ESC}[0m`, "", 8)).toBe(`\nbbb${ESC}[0m`);
  });

  // Codex's counter-examples against the previous heuristic, which pattern-matched the
  // head of the tail and ate ordinary punctuation-then-letter prefixes.
  it.each([
    ["5 files pending", 15],
    ["/api/v1/resource", 16],
    ["3.14 is pi", 10],
    [";not a sequence", 15],
  ])("does not touch plain text that merely looks like a sequence: %s", (text, limit) => {
    expect(appendBoundedOutput(`${"q".repeat(40)}${text}`, "", limit)).toBe(text);
  });

  it("drops only the split sequence, keeping the text that follows it", () => {
    // The cut lands inside the SGR; "RED" after it must survive intact.
    const stream = `${"x".repeat(50)}${ESC}[38;5;196mRED`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("RED");
  });

  it("drops the introducer too when only the ESC was discarded", () => {
    const stream = `${"x".repeat(50)}${ESC}[31mbbb`;
    expect(appendBoundedOutput(stream, "", 7)).toBe("bbb");
  });

  it("keeps a sequence that closed before the cut", () => {
    const stream = `${"x".repeat(50)}${ESC}[31mvisible text`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("visible text");
  });

  // An OSC string ends with BEL, not a CSI final byte, so scanning for 0x40-0x7E would
  // stop inside the title and leave half of it on screen.
  it("drops a split OSC string up to its BEL terminator", () => {
    const stream = `${"x".repeat(50)}${ESC}]0;window title${BEL}after`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("after");
  });

  // ST is the two bytes `ESC \`. Consuming only the ESC leaks a stray backslash.
  it("drops a split OSC string up to its ST terminator, backslash included", () => {
    const stream = `${"x".repeat(50)}${ESC}]0;window title${ESC}\\after`;
    const out = appendBoundedOutput(stream, "", 12);
    expect(out.startsWith("\\")).toBe(false);
    expect(out).toBe("after");
  });

  it("keeps an OSC string that closed with ST before the cut", () => {
    const stream = `${"x".repeat(50)}${ESC}]0;title${ESC}\\visible text`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("visible text");
  });

  // OSC 52 carries the clipboard as base64 and this host enables it deliberately
  // (infra/tmux.ts forwards Claude Code's auto-copy), so payloads run to kilobytes.
  // Any fixed look-behind window loses the introducer and leaks base64 onto the screen.
  it("finds the introducer of an OSC payload far longer than any fixed window", () => {
    const payload = "QUJDRA".repeat(500);
    const stream = `${"x".repeat(50)}${ESC}]52;c;${payload}${BEL}after`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("after");
  });

  it("keeps a long OSC payload that closed before the cut", () => {
    const stream = `${"x".repeat(50)}${ESC}]52;c;${"QUJDRA".repeat(500)}${BEL}visible text`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("visible text");
  });

  it("drops a split two-character sequence", () => {
    const stream = `${"x".repeat(50)}${ESC}Mrest`;
    expect(appendBoundedOutput(stream, "", 5)).toBe("rest");
  });

  it("stays within the limit", () => {
    const stream = `${"z".repeat(500)}\n${"w".repeat(500)}`;
    expect(appendBoundedOutput(stream, "more", 64).length).toBeLessThanOrEqual(64);
  });
});

describe("PrivateModeTracker", () => {
  it("tracks DECSET/DECRST — a reset mode leaves the preamble", () => {
    const t = new PrivateModeTracker();
    t.feed("\x1b[?1049h\x1b[?2004h");
    t.feed("\x1b[?2004l");
    expect(t.preamble()).toBe("\x1b[?1049h");
  });

  it("splits multi-parameter SETs (tmux sends ?1000;1006h as one sequence)", () => {
    const t = new PrivateModeTracker();
    t.feed("\x1b[?1000;1006h");
    expect(t.preamble()).toBe("\x1b[?1000h\x1b[?1006h");
  });

  it("puts the alt-screen switch FIRST so the replayed drawing lands in the right buffer", () => {
    const t = new PrivateModeTracker();
    t.feed("\x1b[?1h\x1b[?1000h\x1b[?1049h");
    expect(t.preamble().startsWith("\x1b[?1049h")).toBe(true);
  });

  it("recognizes a sequence split across output chunks", () => {
    const t = new PrivateModeTracker();
    t.feed("text\x1b[?10");
    t.feed("49h more");
    expect(t.preamble()).toBe("\x1b[?1049h");
  });

  it("is empty with no modes set, and ignores non-private CSI", () => {
    const t = new PrivateModeTracker();
    t.feed("\x1b[31mred\x1b[0m\x1b[2J");
    expect(t.preamble()).toBe("");
  });
});

// The two halves of "a browser attaching later can rebuild this session" travel together, so a
// new spawner cannot record the tail and forget the modes. Removing either line fails a case here.
describe("recordPtyOutput", () => {
  const entry = () => ({ buffer: "", modes: new PrivateModeTracker() });

  it("appends to the bounded tail AND tracks the modes in one call", () => {
    const e = entry();
    recordPtyOutput(e, `${ESC}[?1049h${ESC}[?1006hhello`, 1024);
    expect(e.buffer).toContain("hello");
    expect(e.modes.preamble()).toContain("[?1049h");
    expect(e.modes.preamble()).toContain("[?1006h");
  });

  it("honours the tail limit while still tracking modes that scrolled out of it", () => {
    const e = entry();
    recordPtyOutput(e, `${ESC}[?1000h`, 8);
    recordPtyOutput(e, "0123456789abcdef", 8);
    expect(e.buffer.length).toBeLessThanOrEqual(8);
    expect(e.buffer).not.toContain("[?1000h"); // pushed out of the tail — exactly the bug
    expect(e.modes.preamble()).toContain("[?1000h"); // …but still known
  });
});

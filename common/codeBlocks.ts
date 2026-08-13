// Fenced code blocks in a markdown string (#865).
//
// The point is to hand another app EXACTLY what the agent wrote. Selecting the same text off
// the terminal picks up the leading padding xterm draws with it, which is what breaks a paste
// into Discord or Slack — so the source here is the agent's own transcript markdown, never the
// screen.
//
// Deliberately not a markdown parser. It answers one question — where do the fences sit — and
// the cases below are the ones a real reply produces:
//
//   - ``` and ~~~ are both fences, and a run of 3+ of the same character opens one
//   - a fence closes only on the SAME character, at least as long as the opener. That is what
//     lets a shell snippet contain ``` inside a ~~~~ block without cutting it short
//   - an info string (```ts, ```bash) names the language; the rest of that line is dropped
//   - a fence may be indented up to 3 spaces, per CommonMark
//   - an UNCLOSED fence still yields a block, running to the end of the text. An agent whose
//     output was cut off mid-block is exactly when someone reaches for this, and refusing to
//     return anything would read as "there is no code here"

export interface FencedBlock {
  /** The info string's first word, lower-cased — `ts`, `bash` — or null when absent. */
  lang: string | null;
  /** The block's contents, verbatim apart from the trailing newline. */
  body: string;
}

interface Fence {
  /** The run itself, so its LENGTH can gate what is allowed to close it. */
  run: string;
  /** Everything after the run — the info string on an opener, empty on a closer. */
  info: string;
}

// Scanned by hand rather than with a pattern: the obvious regex (` {0,3}(`{3,}|~{3,})(.*)`)
// nests two quantifiers under an alternation, which the linter flags for super-linear
// backtracking. This walk is plainly one pass, and reads closer to the rule it implements.
// Up to three leading spaces are allowed (CommonMark); a fourth makes it an indented code
// block, not a fence.
function fenceOf(line: string): Fence | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const char = line[i];
  if (char !== "`" && char !== "~") return null;
  let length = 0;
  while (line[i + length] === char) length++;
  if (length < 3) return null;
  return { run: line.slice(i, i + length), info: line.slice(i + length) };
}

// A closing fence is the same character, at least as long, with nothing after it. Compared
// after `.trim()` because trailing whitespace is invisible and would otherwise leave the block
// silently unclosed.
const closes = (line: string, opener: string): boolean => {
  const fence = fenceOf(line);
  return !!fence && fence.run[0] === opener[0] && fence.run.length >= opener.length && fence.info.trim() === "";
};

export function fencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split("\n");
  const blocks: FencedBlock[] = [];
  let i = 0;
  // Each line is read into a const before use: with noUncheckedIndexedAccess, `lines[i]` is
  // `string | undefined` even inside `i < lines.length`, and the loop condition is what actually
  // rules the undefined out.
  while (i < lines.length) {
    const line = lines[i];
    const open = line === undefined ? null : fenceOf(line);
    if (!open) {
      i++;
      continue;
    }
    const fence = open.run;
    const info = open.info.trim();
    const body: string[] = [];
    i++;
    for (let next = lines[i]; next !== undefined && !closes(next, fence); next = lines[i]) {
      body.push(next);
      i++;
    }
    i++; // step over the closing fence (or past the end, for an unclosed block)
    blocks.push({ lang: info ? (info.split(/\s+/)[0]?.toLowerCase() ?? null) : null, body: body.join("\n") });
  }
  return blocks;
}

/** The block a reader means by "the code you just gave me": the last one. Null when the reply
 *  has no fenced block, or when the only ones are empty — an empty clipboard would look
 *  exactly like a copy that silently failed. */
export function lastFencedBlock(markdown: string): FencedBlock | null {
  const withBody = fencedBlocks(markdown).filter((b) => b.body.trim() !== "");
  return withBody[withBody.length - 1] ?? null;
}

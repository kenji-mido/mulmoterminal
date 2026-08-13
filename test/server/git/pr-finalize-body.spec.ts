// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { finalizePrBody, type Runner } from "../../../server/git/worktree-pr.js";
import type { SpawnResult } from "../../../server/git/spawn-collect.js";

const PR_URL = "https://github.com/acme/web/pull/42";
const FOOTER = "work in mulmoclaude3";
const FOOTER_ONLY = { footer: FOOTER, issue: null };

const ok = (stdout: string): SpawnResult => ({ ok: true, stdout, stderr: "" });
const failed = (stderr: string): SpawnResult => ({ ok: false, stdout: "", stderr });

// A Runner that answers `gh pr view` with `body` and records every call.
function fakeRunner(view: SpawnResult, edit: SpawnResult = ok("")) {
  const calls: { args: string[] }[] = [];
  const runner: Runner = (_cmd, args) => {
    calls.push({ args });
    return Promise.resolve(args[1] === "view" ? view : edit);
  };
  return { runner, calls };
}

const editCallOf = (calls: { args: string[] }[]) => calls.find((c) => c.args[1] === "edit");
const editedBody = (calls: { args: string[] }[]) => editCallOf(calls)?.args[4];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finalizePrBody", () => {
  it("edits the PR body to end with the clone name", async () => {
    const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n"));
    await finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner);
    expect(editCallOf(calls)?.args).toEqual(["pr", "edit", PR_URL, "--body", `Repairs the login bug.\n\n${FOOTER}`]);
  });

  // The body has to be READ first: `--body` on `gh pr create` replaces what `--fill` derived
  // from the commits, so the append cannot be folded into the create call.
  it("reads the body before writing it", async () => {
    const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n"));
    await finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner);
    expect(calls[0].args).toEqual(["pr", "view", PR_URL, "--json", "body", "--jq", ".body"]);
  });

  it("writes nothing when the line is already there", async () => {
    const { runner, calls } = fakeRunner(ok(`Repairs the login bug.\n\n${FOOTER}`));
    await finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner);
    expect(editCallOf(calls)).toBeUndefined();
  });

  it("does not read the body at all when there is nothing to add", async () => {
    const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n"));
    await finalizePrBody(PR_URL, { footer: null, issue: null }, "/cwd", runner);
    expect(calls).toEqual([]);
  });

  // Both halves run AFTER the PR exists. Throwing here would surface as "the PR failed" for
  // a PR that was created — the worst possible report.
  it("does not throw when the body cannot be read, and does not guess at an edit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runner, calls } = fakeRunner(failed("gh: not authenticated"));
    await expect(finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner)).resolves.toBeUndefined();
    expect(editCallOf(calls)).toBeUndefined();
  });

  it("does not throw when the edit itself fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runner } = fakeRunner(ok("Repairs the login bug.\n"), failed("network error"));
    await expect(finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner)).resolves.toBeUndefined();
  });

  it("says which PR and which line when it gives up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runner } = fakeRunner(failed("gh: not authenticated"));
    await finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner);
    expect(warn.mock.calls[0][0]).toContain(PR_URL);
    expect(warn.mock.calls[0][0]).toContain(FOOTER);
  });

  it("becomes the whole body when the commits produced none", async () => {
    const { runner, calls } = fakeRunner(ok(""));
    await finalizePrBody(PR_URL, FOOTER_ONLY, "/cwd", runner);
    expect(editedBody(calls)).toBe(FOOTER);
  });

  describe("the issue reference (#1171)", () => {
    it("adds `Fixes #N` so merging closes the issue the work started from", async () => {
      const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n"));
      await finalizePrBody(PR_URL, { footer: null, issue: 1171 }, "/cwd", runner);
      expect(editedBody(calls)).toBe("Repairs the login bug.\n\nFixes #1171");
    });

    // The clone line is a FOOTER. Adding the issue reference after it would leave it mid-body —
    // which is exactly what two separate read-modify-writes would have produced.
    it("puts the issue reference above the clone line, in one edit", async () => {
      const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n"));
      await finalizePrBody(PR_URL, { footer: FOOTER, issue: 1171 }, "/cwd", runner);
      expect(editedBody(calls)).toBe(`Repairs the login bug.\n\nFixes #1171\n\n${FOOTER}`);
      expect(calls.filter((c) => c.args[1] === "edit")).toHaveLength(1);
    });

    // `--fill` copies the commits verbatim, so an agent that already wrote a keyword has said what
    // this PR closes. A second one naming a different issue would close both.
    it("leaves a body that already declares a closing reference alone", async () => {
      const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n\nCloses #900"));
      await finalizePrBody(PR_URL, { footer: null, issue: 1171 }, "/cwd", runner);
      expect(editCallOf(calls)).toBeUndefined();
    });

    it("does not stack a second copy of the same reference", async () => {
      const { runner, calls } = fakeRunner(ok("Repairs the login bug.\n\nFixes #1171"));
      await finalizePrBody(PR_URL, { footer: null, issue: 1171 }, "/cwd", runner);
      expect(editCallOf(calls)).toBeUndefined();
    });
  });
});

// @vitest-environment node
//
// The roster is keyed by an address the rules compare EXACTLY (`email() in a.members`, and rules
// have no `lower()`). Firebase puts a lower-cased address in the token, so a key with capitals
// grants nothing — and nothing fails: the deploy succeeds, the file reads correctly to a human,
// and the person invited is refused everything with no error naming them.
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAuthoredApp } from "@mulmoclaude/core/collection/server";
import { declarationProblems } from "../../../server/backends/sharedApp/context.js";
import { inviteToSharedApp } from "../../../server/backends/sharedApp/declare.js";

const appWith = (members: Record<string, Record<string, string>>) => {
  const parsed = parseAuthoredApp(JSON.stringify({ aid: "a1", members }));
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.app;
};

const owner = { email: "o@e.com", uid: "u1" };

const caseProblems = (members: Record<string, Record<string, string>>, handle: { email: string; uid: string } | null = owner) =>
  declarationProblems(appWith(members), [], handle).filter((problem) => problem.includes("lower case"));

describe("declarationProblems: roster address case", () => {
  it("says so when an invited address the rules will never match is on the roster", () => {
    const problems = caseProblems({ "o@e.com": { "*": "owner" }, "Foo@Example.com": { survey: "participant" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Foo@Example.com");
    expect(problems[0]).toContain("foo@example.com");
  });

  it("is quiet about a roster written in lower case", () => {
    expect(caseProblems({ "o@e.com": { "*": "owner" }, "foo@example.com": { survey: "participant" } })).toEqual([]);
  });

  // The signed-in address IS what the rules compare against, so a provider that hands over
  // capitals is right and the check would be wrong.
  it("exempts the address this session is signed in with, whatever its case", () => {
    expect(caseProblems({ "Owner@Example.com": { "*": "owner" } }, { email: "Owner@Example.com", uid: "u1" })).toEqual([]);
  });
});

const manifestAt = async (root: string) => JSON.parse(await readFile(path.join(root, "app.json"), "utf-8")) as { members: Record<string, unknown> };

const repoWith = async (members: Record<string, unknown>) => {
  const root = await mkdtemp(path.join(tmpdir(), "roster-case-"));
  await writeFile(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members }, null, 2));
  return root;
};

describe("inviteToSharedApp", () => {
  it("writes a new address in lower case, so the rules can match it", async () => {
    const root = await repoWith({ "o@e.com": { "*": "owner" } });

    const result = await inviteToSharedApp(root, "Foo@Example.com", "participant", "survey");

    expect(result.ok).toBe(true);
    expect(Object.keys((await manifestAt(root)).members)).toEqual(["o@e.com", "foo@example.com"]);
  });

  // Which entry the operation is ABOUT is decided before the normalization can matter. Otherwise
  // a removal looks up a key nobody has, changes nothing, and still reports success.
  it("removes the entry a roster spells with capitals", async () => {
    const root = await repoWith({ "o@e.com": { "*": "owner" }, "Foo@Example.com": { survey: "participant" } });

    const result = await inviteToSharedApp(root, "foo@example.com", null, "survey");

    expect(result.ok).toBe(true);
    expect(Object.keys((await manifestAt(root)).members)).toEqual(["o@e.com"]);
  });

  // The other half of the same bug: a second key beside the first, one of which still holds the
  // permissions the operator believed they had just changed.
  it("changes that entry in place rather than adding a lower-cased twin", async () => {
    const root = await repoWith({ "o@e.com": { "*": "owner" }, "Foo@Example.com": { survey: "participant" } });

    const result = await inviteToSharedApp(root, "Foo@Example.com", "viewer", "survey");

    expect(result.ok).toBe(true);
    const members = (await manifestAt(root)).members;
    expect(Object.keys(members)).toEqual(["o@e.com", "Foo@Example.com"]);
    expect(members["Foo@Example.com"]).toEqual({ survey: "viewer" });
    // And it reports the key it actually wrote, not the address that was typed.
    expect(result.ok && result.email).toBe("Foo@Example.com");
  });

  // Two keys for one person is a hand edit, and picking one would be an invisible guess: the
  // other entry keeps its permissions while the tool reports the change as done.
  it("refuses when the roster spells one address two ways, and names both", async () => {
    const members = { "o@e.com": { "*": "owner" }, "foo@example.com": { survey: "participant" }, "Foo@Example.com": { survey: "editor" } };
    const root = await repoWith(members);

    const result = await inviteToSharedApp(root, "foo@example.com", null, "survey");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(" ")).toContain('"foo@example.com", "Foo@Example.com"');
    // Refused means the file is untouched — neither entry half-removed.
    expect((await manifestAt(root)).members).toEqual(members);
  });
});

describe("a role that has to be about a collection", () => {
  // `assignee` means "the rows assigned to you", and what counts as assigned is
  // declared per collection. An app-wide one is refused by publish — so the
  // question here is only whether the author finds out now or after a deploy
  // they believed had worked.
  it("refuses an app-wide assignee, and writes nothing", async () => {
    const members = { "o@e.com": { "*": "owner" } };
    const root = await repoWith(members);

    const result = await inviteToSharedApp(root, "anna@salon.jp", "assignee", "*");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(" ")).toContain("cannot be given for the whole app");
    // Not a warning attached to a write that happened anyway: refused means the
    // roster still says what it said.
    expect((await manifestAt(root)).members).toEqual(members);
  });

  it("takes the same role for a named collection", async () => {
    const root = await repoWith({ "o@e.com": { "*": "owner" } });

    const result = await inviteToSharedApp(root, "anna@salon.jp", "assignee", "bookings");

    expect(result.ok).toBe(true);
    expect((await manifestAt(root)).members["anna@salon.jp"]).toEqual({ bookings: "assignee" });
  });

  it("leaves every other role app-wide", async () => {
    // The refusal is about this one role, not about `"*"`.
    const root = await repoWith({ "o@e.com": { "*": "owner" } });

    expect((await inviteToSharedApp(root, "sam@e.com", "viewer", "*")).ok).toBe(true);
    expect((await manifestAt(root)).members["sam@e.com"]).toEqual({ "*": "viewer" });
  });
});

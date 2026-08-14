// @vitest-environment node
//
// The tool's contract with the agent is ACTIONABLE PROSE, and that is the part a refusal is most
// likely to break: an operation that throws reaches the agent as a tool crash, which it will
// retry rather than report. So every path out of here is a string.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { MANAGE_SHARED_APP, SHARED_APP_ACTIONS, manageSharedApp } from "../../../server/infra/shared-app-tool.js";
import { HOST_TOOL_DEFINITIONS } from "../../../server/infra/host-tools.js";
import { groupOfTool } from "../../../common/toolGroups.js";
import { setFirestoreAccessor, setSharedCollectionsSupport } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { makeTempDir } from "../../support/tempDir";
import path from "node:path";

/** The accessor hands back a Firestore adapter; `init` never uses it, but the shape is required. */
const FAKE_DOCS = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  create: () => Promise.resolve(true),
  delete: () => Promise.resolve(true),
  watch: () => () => {},
};

describe("manageSharedApp, the tool", () => {
  beforeAll(() => {
    // Discovery needs a bound host: `check` reads this repository's collections, and without the
    // binding it throws rather than reporting. ONE call per file — the binding refuses a second.
    initCollectionsBackend({ workspace: makeTempDir("mt-shared-tool-ws-") });
    // Signed out on purpose: it is the state `check` has to work in, and the state the other
    // operations have to refuse in.
    setSharedCollectionsSupport(true);
    setFirestoreAccessor(null);
  });

  it("is registered as a host tool and reaches the group the collections live in", () => {
    expect(HOST_TOOL_DEFINITIONS.map((d) => d.name)).toContain("manageSharedApp");
    // Ungrouped would mean it is offered only through the all-tools URL — a cell with the
    // Collections pane would have the store and no way to deploy it.
    expect(groupOfTool("manageSharedApp")).toBe("data");
  });

  it("names the three operations in the schema the agent is given", () => {
    expect(SHARED_APP_ACTIONS).toEqual(["init", "fork", "check", "invite", "deploy", "publish", "unpublish"]);
    expect(MANAGE_SHARED_APP.parameters?.properties?.action).toMatchObject({ enum: [...SHARED_APP_ACTIONS] });
  });

  it("answers an unknown action with the ones that exist", async () => {
    expect(await manageSharedApp(makeTempDir("mt-shared-tool-"), { action: "ship" })).toContain("init, fork, check, invite, deploy, publish, unpublish");
    expect(await manageSharedApp(makeTempDir("mt-shared-tool-"), {})).toContain("init, fork, check, invite, deploy, publish, unpublish");
  });

  it("refuses to start an app in a repository that already declares one", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: {} }));
    // Overwriting would revoke the whole roster without saying so.
    expect(await manageSharedApp(root, { action: "init", name: "Second" })).toContain("already");
  });

  it("calls a sound declaration deployable while signed out", async () => {
    // The publisher check asks whether the caller is an app-wide owner, so an empty address is not
    // neutral — it reported a missing owner for every signed-out call, and `check` could never
    // come back clean. Signed out, the honest question is "would this deploy for the owner it
    // names?", and the answer has to be able to be yes.
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", name: "Survey", members: { "o@e.com": { "*": "owner" } } }));

    const message = await manageSharedApp(root, { action: "check" });
    expect(message).toContain("deployable");
    expect(message).toContain("o@e.com");
  });

  it("checks the declaration without a session, and without writing", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: { "o@e.com": { "*": "owner" } }, slug: "Not A Slug" }));

    const message = await manageSharedApp(root, { action: "check" });
    // The strict declaration refuses that slug's shape, and `check` is where an author is meant to
    // learn it — not at a deploy, and not from a live refusal.
    expect(message).toContain("slug");
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).slug).toBe("Not A Slug");
  });

  it("adds and removes one roster entry, leaving the rest of the file alone", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", name: "Survey", members: { "o@e.com": { "*": "owner" } } }));

    expect(await manageSharedApp(root, { action: "invite", email: "t@e.com", role: "viewer" })).toContain("viewer");
    const after = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8"));
    expect(after.members).toEqual({ "o@e.com": { "*": "owner" }, "t@e.com": { "*": "viewer" } });
    expect(after.name).toBe("Survey");

    expect(await manageSharedApp(root, { action: "invite", email: "t@e.com" })).toContain("Removed");
    // Removed ENTIRELY rather than left as an empty object: the rules require the roster and its
    // email list to agree, and a half-removed entry is a permission somebody still holds.
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).members).toEqual({ "o@e.com": { "*": "owner" } });
  });

  it("writes the SIGNED-IN address as owner, and generates the aid", async () => {
    // The whole reason `init` is an operation: the owner has to be the address the rules will see,
    // the agent cannot read it, and the address a user offers is the one that fails at deploy.
    const root = makeTempDir("mt-shared-tool-");
    setFirestoreAccessor(() => ({ docs: FAKE_DOCS, email: "signed-in@example.com", uid: "uid-1" }));
    try {
      const message = await manageSharedApp(root, { action: "init", name: "Talk feedback", slug: "aug-talk-survey" });
      expect(message).toContain("signed-in@example.com");
      const written = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8"));
      expect(written.members).toEqual({ "signed-in@example.com": { "*": "owner" } });
      expect(written.aid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(written.name).toBe("Talk feedback");
      expect(written.slug).toBe("aug-talk-survey");
    } finally {
      setFirestoreAccessor(null);
    }
  });

  it("refuses to leave the app without an owner", async () => {
    // An app with no app-wide owner has no publisher: every deploy is refused, including the one
    // that would put an owner back.
    const root = makeTempDir("mt-shared-tool-");
    const roster = { "o@e.com": { "*": "owner" }, "t@e.com": { "*": "viewer" } };
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: roster }));

    expect(await manageSharedApp(root, { action: "invite", email: "o@e.com" })).toContain("no owner");
    expect(await manageSharedApp(root, { action: "invite", email: "o@e.com", role: "viewer" })).toContain("no owner");
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).members).toEqual(roster);

    // With a second owner in place, the first may go.
    await manageSharedApp(root, { action: "invite", email: "t@e.com", role: "owner" });
    expect(await manageSharedApp(root, { action: "invite", email: "o@e.com" })).toContain("Removed");
  });

  it("catches, while signed in, what a deploy would refuse about `owner`", async () => {
    // `check` answers "would a deploy be refused?", so it has to run the SAME gate. A second
    // implementation answers differently, and this one answered optimistically: a declaration
    // naming somebody else's uid checked clean and was refused a moment later.
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(
      path.join(root, "app.json"),
      JSON.stringify({ aid: "a1", members: { "signed-in@example.com": { "*": "owner" } }, owner: "somebody-elses-uid" }),
    );
    setFirestoreAccessor(() => ({ docs: FAKE_DOCS, email: "signed-in@example.com", uid: "uid-1" }));
    try {
      expect(await manageSharedApp(root, { action: "check" })).toContain("somebody-elses-uid");
    } finally {
      setFirestoreAccessor(null);
    }
  });

  it("returns every refusal as text rather than throwing", async () => {
    const root = makeTempDir("mt-shared-tool-");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "a1", members: {} }));
    // The three that reach the APP need a session and say so. `check` and `invite` are about the
    // file and need none; `init` refuses here because the declaration already exists.
    for (const action of ["deploy", "publish", "unpublish"]) {
      const message = await manageSharedApp(root, { action });
      expect(typeof message).toBe("string");
      expect(message).toContain("signed-in Firestore session");
    }
  });
});

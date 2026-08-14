// @vitest-environment node
//
// The feature this whole change exists for, asserted end to end: TWO roots, each owning a
// collection under the SAME slug, served through the same routes without bleeding into each
// other. Nothing before this could express it — with one ambient root, a slug was globally
// unique by construction, so "reads the right one" was true by accident rather than by rule.
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appRequest } from "../../helpers/appRequest.js";
import { initCollectionsBackend, mountCollectionRoutes } from "../../../server/backends/collections.js";
// Mounted separately in app-routes.ts, so a spec that exercises it mounts it separately too.
import { mountSelfContainmentRoutes } from "../../../server/backends/collectionSelfContainment.js";
import { projectId } from "../../../server/infra/project-root.js";
import { manageCollectionHandlerFor } from "../../../server/infra/collection-tool.js";
import { makeTempDir } from "../../support/tempDir";

const schemaFor = (title: string) => ({
  title,
  icon: "star",
  dataPath: "data/tasks/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name" },
  },
  views: [{ id: "v1", file: "views/v1.html", label: "Custom", capabilities: ["read"] }],
});

/** A root holding one `tasks` collection with one record — the same slug in both, which is
 *  the case a single-root engine could not tell apart. */
function makeProject(prefix: string, title: string, recordName: string): string {
  const root = makeTempDir(prefix);
  mkdirSync(path.join(root, ".claude", "skills", "tasks"), { recursive: true });
  writeFileSync(path.join(root, ".claude", "skills", "tasks", "schema.json"), JSON.stringify(schemaFor(title)));
  // In the SKILL dir, not under `data/skills`. That staging tree is a workspace mechanism — it
  // exists so the agent can write skill drafts without crossing the `.claude/` permission gate,
  // and a bridge mirrors the allowlisted files across. A project folder has no such gate: the
  // files live where git carries them, which is also what makes the collection survive a clone
  // (plans/feat-collections-project-root.md §6.5, §11).
  mkdirSync(path.join(root, ".claude", "skills", "tasks", "views"), { recursive: true });
  writeFileSync(path.join(root, ".claude", "skills", "tasks", "views", "v1.html"), "<head></head><body>view</body>");
  mkdirSync(path.join(root, "data", "tasks", "items"), { recursive: true });
  writeFileSync(path.join(root, "data", "tasks", "items", "one.json"), JSON.stringify({ id: "one", name: recordName }));
  return root;
}

describe("collections served from a named project", () => {
  let request: ReturnType<typeof appRequest>;
  let workspace = "";
  let other = "";

  beforeAll(() => {
    workspace = makeProject("mt-scope-ws-", "Workspace Tasks", "from-workspace");
    other = makeProject("mt-scope-other-", "Other Tasks", "from-other");
    initCollectionsBackend({ workspace, knownProjects: () => [{ label: "other", path: other }] });

    const app = express();
    app.use(express.json());
    mountCollectionRoutes(app);
    mountSelfContainmentRoutes(app);
    request = appRequest(app);
  });

  it("serves the workspace when no project is named", async () => {
    const res = await request("/api/collections/tasks/detail");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collection: { title: string }; items: Array<{ name: string }> };
    expect(body.collection.title).toBe("Workspace Tasks");
    expect(body.items.map((item) => item.name)).toEqual(["from-workspace"]);
  });

  // The assertion the feature is about: same slug, same route, different root.
  it("serves the named project's collection under the same slug", async () => {
    const res = await request(`/api/collections/tasks/detail?project=${projectId(other)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collection: { title: string }; items: Array<{ name: string }> };
    expect(body.collection.title).toBe("Other Tasks");
    expect(body.items.map((item) => item.name)).toEqual(["from-other"]);
  });

  // The portability report is scoped like every other read: it answers about the PROJECT's
  // collection, not the workspace's collection of the same name.
  it("reports self-containment for the named project's collection", async () => {
    const res = await request(`/api/collections/tasks/self-containment?project=${projectId(other)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string; portable: boolean; findings: Array<{ code: string }> };
    expect(body.slug).toBe("tasks");
    // These fixture roots are tmpdirs, not repos — so the report says exactly that, and the
    // checks that depend on git are reported as not run rather than as passed.
    expect(body.findings.map((finding) => finding.code)).toEqual(["not-a-repo"]);
    expect(body.portable).toBe(true);
  });

  it("404s the report for a slug the project does not have", async () => {
    expect((await request("/api/collections/nope/self-containment")).status).toBe(404);
  });

  it("writes into the named project, leaving the workspace untouched", async () => {
    const created = await request(`/api/collections/tasks/items?project=${projectId(other)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "two", name: "written-in-other" }),
    });
    expect(created.status).toBe(200);

    const inOther = (await (await request(`/api/collections/tasks/detail?project=${projectId(other)}`)).json()) as { items: Array<{ id: string }> };
    expect(inOther.items.map((item) => item.id).sort()).toEqual(["one", "two"]);

    const inWorkspace = (await (await request("/api/collections/tasks/detail")).json()) as { items: Array<{ id: string }> };
    expect(inWorkspace.items.map((item) => item.id)).toEqual(["one"]);
  });

  // A typo in a query parameter is the client's error. Answering 500 would read as "the server
  // broke", and — worse — an ignored parameter would have served the workspace silently.
  it("answers 400 for a project it cannot resolve", async () => {
    const res = await request("/api/collections/tasks/detail?project=0123456789abcdef");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unknown project");
  });

  // The token names the project; the URL handed to the iframe must stay CLEAN. The bundled
  // custom-view contract builds its other endpoints by concatenation (`dataUrl + "/query"`), so
  // a trailing `?project=` would land inside the suffix and 401 every one of them.
  it("mints a view token for the named project whose dataUrl carries no query", async () => {
    const res = await request(`/api/collections/tasks/view-token?project=${projectId(other)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; dataUrl: string };
    expect(body.dataUrl).toBe("/api/collections/tasks/view-data");

    // A token is signed, not encrypted: the payload is plain base64url JSON that the iframe can
    // read. It must name the project by id — an absolute root here would publish the user's
    // home directory to the LLM-authored page the token is handed to.
    const payload = JSON.parse(Buffer.from(body.token.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(payload.project).toBe(projectId(other));
    expect(JSON.stringify(payload)).not.toContain(other);
  });

  // The token alone must scope the read — the iframe sends no project in the URL.
  it("serves view-data for the token's project without a project in the URL", async () => {
    const minted = (await (
      await request(`/api/collections/tasks/view-token?project=${projectId(other)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewId: "v1" }),
      })
    ).json()) as { token: string; dataUrl: string };

    const res = await request(minted.dataUrl, { headers: { authorization: `Bearer ${minted.token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }> };
    const names = body.items.map((item) => item.name);
    expect(names).toContain("from-other");
    expect(names).not.toContain("from-workspace");
  });

  // The agent's own data plane. `manageCollection` used to be bound to the workspace, so an
  // agent asked to create a collection "here" created it somewhere else — and, unlike the routes
  // above, nothing in the request said which project it meant. It reads the session's cwd now.
  it("runs the agent's manageCollection against the session's directory", async () => {
    const inOther = await manageCollectionHandlerFor(other)({ action: "getSchema", slug: "tasks" });
    expect(inOther).toContain("Other Tasks");
    expect(inOther).not.toContain("Workspace Tasks");

    // …and the workspace-bound one still answers for the workspace, so the two roots are told
    // apart by the handler rather than by whichever was configured last.
    const inWorkspace = await manageCollectionHandlerFor(workspace)({ action: "getSchema", slug: "tasks" });
    expect(inWorkspace).toContain("Workspace Tasks");
  });

  it("scopes the collection LIST to the named project too, not only the detail route", async () => {
    const res = await request("/api/collections/list?project=" + projectId(other));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collections: Array<{ slug: string; title: string }> };
    expect(body.collections.find((c) => c.slug === "tasks")?.title).toBe("Other Tasks");
  });
});

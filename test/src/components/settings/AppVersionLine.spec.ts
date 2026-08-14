// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { UpdateStatus } from "../../../../common/updateStatus";

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  ready: true,
  install: "npm",
  version: "4.7.0",
  commit: null,
  latest: null,
  notice: null,
  ...over,
});

// The composable behind this component holds ONE module-level status for the whole app, so each
// case has to start from a fresh module graph or it reads the previous case's answer.
async function mountWith(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
  vi.resetModules();
  const AppVersionLine = (await import("../../../../src/components/settings/AppVersionLine.vue")).default;
  const w = mount(AppVersionLine);
  await flushPromises();
  return w;
}

const versionText = (w: Awaited<ReturnType<typeof mountWith>>) => w.find('[data-testid="settings-app-version"]').text();
const commit = (w: Awaited<ReturnType<typeof mountWith>>) => w.find('[data-testid="settings-app-commit"]');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AppVersionLine", () => {
  // Labelled, so a string of numbers under the title reads as the version rather than decoration.
  it("shows the package version under a Version label", async () => {
    const w = await mountWith(status());
    expect(versionText(w)).toBe("4.7.0");
    expect(w.text()).toContain("Version");
    expect(commit(w).exists()).toBe(false);
  });

  // The hex says what it is, rather than leaving the reader to guess.
  it("names the commit of a git checkout", async () => {
    const w = await mountWith(status({ install: "git", commit: "a1b2c3d" }));
    expect(versionText(w)).toBe("4.7.0");
    expect(commit(w).text()).toBe("commit a1b2c3d");
  });

  // The header badge is behind the modal while it is open, so this is the only place the update
  // is visible — including the command, which is the part a user came for.
  it("repeats the update notice when there is one", async () => {
    const w = await mountWith(status({ latest: "4.8.0", notice: "Update available: 4.7.0 → 4.8.0  ·  run: npm i -g mulmoterminal" }));
    expect(w.text()).toContain("run: npm i -g mulmoterminal");
  });

  it("says nothing about an update when the install is current", async () => {
    expect((await mountWith(status())).text()).not.toContain("Update available");
  });

  // An unreadable answer must leave the line out rather than print a version nobody is on.
  it("renders nothing when the status cannot be read", async () => {
    expect((await mountWith({ error: "nope" })).find('[data-testid="settings-app-version"]').exists()).toBe(false);
  });

  // Deliberate, and CodeRabbit proposed the opposite on #1524: the version is known to the server
  // synchronously and is the same value either way, so it shows at once instead of blanking the
  // row for as long as the probe takes. Only `commit` — which needs the install kind the probe
  // decides — waits for `ready`.
  it("shows the version before the check has landed, without a commit", async () => {
    const w = await mountWith(status({ ready: false, install: "git", commit: "a1b2c3d" }));
    expect(versionText(w)).toBe("4.7.0");
    expect(commit(w).exists()).toBe(false);
  });
});

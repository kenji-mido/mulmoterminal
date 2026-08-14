// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../../../../src/composables/useAttentionSound", () => ({ previewNotify: vi.fn() }));

import NotificationSoundsSection from "../../../../src/components/settings/NotificationSoundsSection.vue";

const mountSection = () =>
  mount(NotificationSoundsSection, { props: { soundFile: null, soundKinds: [], sounds: {} }, global: { stubs: { SkillLaunchButton: true } } });

const browse = async (w: ReturnType<typeof mountSection>) => {
  const button = w.findAll("button").find((b) => b.text().includes("Browse"));
  await button?.trigger("click");
  await flushPromises();
};

// #1447: the third call site of the OS file dialog. It swallowed the failure like the other two,
// so on a host without one the Browse button did nothing — with the typed-path field right beside
// it as the way out, unmentioned.
describe("the notification sound's Browse button", () => {
  it("shows why no dialog opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "No file dialog on this host — install zenity" }), { status: 500 }))),
    );
    const w = mountSection();
    await browse(w);
    expect(w.find('[data-testid="sound-pick-error"]').text()).toContain("install zenity");
    vi.unstubAllGlobals();
  });

  it("says nothing when the user simply cancels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ paths: [] }), { status: 200 }))),
    );
    const w = mountSection();
    await browse(w);
    expect(w.find('[data-testid="sound-pick-error"]').exists()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("adopts the chosen file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ paths: ["/sounds/ping.wav"] }), { status: 200 }))),
    );
    const w = mountSection();
    await browse(w);
    expect(w.emitted("update-sound")?.at(-1)).toEqual(["/sounds/ping.wav"]);
    vi.unstubAllGlobals();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SettingsModal from "../../../src/components/SettingsModal.vue";
import SkillLaunchButton from "../../../src/components/SkillLaunchButton.vue";
import { VOICE_LANGUAGES } from "../../../src/composables/voiceLanguage";
import { useTheme } from "../../../src/composables/useTheme";
import { BUNDLED_SKILL_NAMES } from "../../../common/bundledSkills";

const mountModal = (props: Record<string, unknown> = {}) => mount(SettingsModal, { props });

function clickBtn(w: ReturnType<typeof mount>, match: (text: string) => boolean) {
  const btn = w.findAll("button").find((b) => match(b.text()));
  if (!btn) throw new Error("button not found");
  return btn.trigger("click");
}

describe("SettingsModal theme picker", () => {
  // The theme state is a module singleton read at import time, so the selection has to be made
  // through its own API — writing localStorage in the test would be read by nothing.
  const themeRadios = (w: ReturnType<typeof mount>) => w.findAll('[role="radio"]').filter((r) => r.attributes("title") !== undefined);
  const tabStops = (w: ReturnType<typeof mount>) => themeRadios(w).filter((r) => r.attributes("tabindex") === "0");

  it("makes the selected theme the tab stop", () => {
    useTheme().setTheme("nord");
    const w = mountModal();
    expect(tabStops(w)).toHaveLength(1);
    expect(tabStops(w)[0].text()).toContain("Nord");
  });

  // Codex review on #996: with a selection naming a theme that isn't in the list — the
  // missing-theme case this build introduced — nothing matched, so every option was
  // tabindex="-1" and a keyboard user could not reach the picker the notice tells them to use.
  it("keeps one tab stop when the selection names a theme that is gone", () => {
    useTheme().setTheme("vanished-theme");
    const w = mountModal();
    expect(w.find('[data-testid="theme-missing"]').exists()).toBe(true);
    expect(tabStops(w)).toHaveLength(1);
    useTheme().setTheme("midnight");
  });
});

describe("SettingsModal", () => {
  it("no longer renders the directory-presets editor (presets are auto-managed)", () => {
    const w = mountModal();
    expect(w.find(".label-field").exists()).toBe(false);
    expect(w.find(".path-field").exists()).toBe(false);
    expect(w.findAll(".row")).toHaveLength(0);
    expect(w.text()).not.toContain("Directory presets");
  });

  it("emits close on the Close button", async () => {
    const w = mountModal();
    await clickBtn(w, (t) => t === "Close");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("emits close on Escape", async () => {
    const w = mountModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("shows the configured custom sound and emits update-sound on edit / clear", async () => {
    const w = mountModal({ soundFile: "/snd/alert.wav" });
    const field = w.find('[aria-label="Custom notification sound file"]');
    expect((field.element as HTMLInputElement).value).toBe("/snd/alert.wav");

    await field.setValue("  /snd/new.mp3  ");
    await field.trigger("change");
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBe("/snd/new.mp3"); // trimmed

    await clickBtn(w, (t) => t.includes("chime"));
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBeNull(); // back to the chime
  });

  it("reflects pushEnabled and emits update-push-enabled on toggle", async () => {
    const w = mountModal({ pushEnabled: true });
    const box = w.find<HTMLInputElement>('[aria-label="Send a Web Push to my devices"]');
    expect(box.element.checked).toBe(true);
    await box.setValue(false);
    expect(w.emitted("update-push-enabled")?.at(-1)?.[0]).toBe(false);

    // Defaults to unchecked when the prop is unset, and emits true when toggled on.
    const w2 = mountModal({});
    const box2 = w2.find<HTMLInputElement>('[aria-label="Send a Web Push to my devices"]');
    expect(box2.element.checked).toBe(false);
    await box2.setValue(true);
    expect(w2.emitted("update-push-enabled")?.at(-1)?.[0]).toBe(true);
  });

  // The setting exists so a user drowning in "waiting" pushes can keep the finished ones (#850),
  // so the emitted list — not just the click — is what matters.
  it("reflects pushKinds and emits the remaining kinds when one is unticked", async () => {
    const w = mountModal({ pushEnabled: true, pushKinds: ["finished", "waiting"] });
    const waiting = w.find<HTMLInputElement>('[aria-label="Push when a session is waiting"]');
    expect(waiting.element.checked).toBe(true);
    await waiting.setValue(false);
    expect(w.emitted("update-push-kinds")?.at(-1)?.[0]).toEqual(["finished"]);
  });

  it("emits in the canonical order however the boxes were clicked", async () => {
    const w = mountModal({ pushEnabled: true, pushKinds: [] });
    await w.find<HTMLInputElement>('[aria-label="Push when a session is waiting"]').setValue(true);
    expect(w.emitted("update-push-kinds")?.at(-1)?.[0]).toEqual(["waiting"]);
    await w.find<HTMLInputElement>('[aria-label="Push when a session is finished"]').setValue(true);
    expect(w.emitted("update-push-kinds")?.at(-1)?.[0]).toEqual(["finished", "waiting"]);
  });

  // The kinds decide nothing while the master switch is off, so offering them as live controls
  // would suggest otherwise.
  it("disables the kind checkboxes when push is off", () => {
    const w = mountModal({ pushEnabled: false, pushKinds: ["finished"] });
    expect(w.find<HTMLInputElement>('[aria-label="Push when a session is finished"]').element.disabled).toBe(true);
  });

  it("Browse fills the sound path from the OS file picker and applies it", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ paths: ["/picked/sound.ogg"] }) })) as unknown as typeof fetch;
    const w = mountModal({ soundFile: null });
    await clickBtn(w, (t) => t.includes("Browse"));
    await Promise.resolve();
    expect((w.find('[aria-label="Custom notification sound file"]').element as HTMLInputElement).value).toBe("/picked/sound.ogg");
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBe("/picked/sound.ogg");
  });

  it("theme picker honors the radiogroup keyboard contract (arrows + roving tabindex)", async () => {
    const w = mountModal();
    const cards = () => w.findAll('[role="radio"]');
    const n = cards().length;
    expect(n).toBeGreaterThanOrEqual(2);
    const checked = () => cards().findIndex((c) => c.attributes("aria-checked") === "true");

    const start = checked();
    // roving tabindex: only the checked radio is tabbable
    expect(cards()[start].attributes("tabindex")).toBe("0");
    expect(cards()[(start + 1) % n].attributes("tabindex")).toBe("-1");

    await cards()[start].trigger("keydown", { key: "ArrowRight" });
    expect(checked()).toBe((start + 1) % n); // advances, wrapping at the end

    await cards()[checked()].trigger("keydown", { key: "ArrowLeft" });
    expect(checked()).toBe(start); // back to where we started
  });

  // The section offers a setting for a mic that only exists on a machine that can transcribe
  // (macOS + whisper-server + ffmpeg), so its whole contract is "appears iff the server says
  // capable" — including when the server can't be reached at all.
  describe("Voice input section", () => {
    const VOICE_URL = "/api/transcribe/model";
    const stubStatus = (respond: (url: string) => { ok: boolean; json: () => Promise<unknown> }) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => respond(url)),
      );
    // Every other GET the modal fires on open resolves to an empty body it tolerates.
    const otherRoutes = { ok: true, json: async () => ({}) };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const voiceSelect = (w: ReturnType<typeof mount>) => w.find('[aria-label="Language for voice input"]');

    it("shows the language picker when the server reports capable", async () => {
      stubStatus((url) => (url === VOICE_URL ? { ok: true, json: async () => ({ capable: true, model: { name: "base", state: "ready" } }) } : otherRoutes));

      const w = mountModal();
      await flushPromises();
      expect(voiceSelect(w).exists()).toBe(true);
      expect(w.text()).toContain("Voice input");
    });

    it("offers every language the picker exports, plus locale and auto", async () => {
      stubStatus((url) => (url === VOICE_URL ? { ok: true, json: async () => ({ capable: true, model: { name: "base", state: "ready" } }) } : otherRoutes));

      const w = mountModal();
      await flushPromises();
      const values = voiceSelect(w)
        .findAll("option")
        .map((o) => o.attributes("value"));
      expect(values).toEqual(["locale", "auto", ...VOICE_LANGUAGES.map((l) => l.code)]);
    });

    it("hides the section when the machine cannot transcribe", async () => {
      stubStatus((url) => (url === VOICE_URL ? { ok: true, json: async () => ({ capable: false, model: { name: "base", state: "idle" } }) } : otherRoutes));

      const w = mountModal();
      await flushPromises();
      expect(voiceSelect(w).exists()).toBe(false);
      expect(w.text()).not.toContain("Voice input");
    });

    // A probe that never answers must read as "no voice input", not as an empty section or a
    // thrown error inside onMounted.
    it("hides the section when the probe fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        }),
      );

      const w = mountModal();
      await flushPromises();
      expect(voiceSelect(w).exists()).toBe(false);
    });

    it("hides the section when the route is absent", async () => {
      stubStatus((url) => (url === VOICE_URL ? { ok: false, json: async () => ({}) } : otherRoutes));

      const w = mountModal();
      await flushPromises();
      expect(voiceSelect(w).exists()).toBe(false);
    });
  });

  describe("Google account link (broker support)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("disables sign-in when client secret is missing and broker is unavailable", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: false, lastError: null }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const w = mountModal();
      await flushPromises();
      const signInBtn = w.findAll("button").find((b) => b.text().includes("Sign in"));
      expect(signInBtn).toBeTruthy();
      expect(signInBtn?.attributes("disabled")).toBe("");
    });

    it("enables sign-in when client secret is missing but broker is available", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: true, lastError: null }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const w = mountModal();
      await flushPromises();
      const signInBtn = w.findAll("button").find((b) => b.text().includes("Sign in"));
      expect(signInBtn).toBeTruthy();
      expect(signInBtn?.attributes("disabled")).toBeUndefined();
    });

    it("hides the client secret warning when broker is available", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: true, lastError: null }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const w = mountModal();
      await flushPromises();
      const warning = w.find('[data-testid="google-warn"]');
      expect(warning.exists()).toBe(false);
    });

    it("shows the client secret warning when broker is unavailable and secret is missing", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: false, lastError: null }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const w = mountModal();
      await flushPromises();
      const warning = w.find('[data-testid="google-warn"]');
      expect(warning.exists()).toBe(true);
      expect(warning.text()).toContain("client_secret");
    });
  });
});

describe("SettingsModal per-kind sounds (#873)", () => {
  const selectFor = (w: ReturnType<typeof mount>, label: string) => w.find(`select[aria-label="Sound for ${label}"]`);

  // SELECT_CONTROL is `w-full`. A width utility written NEXT to it on the same element has the
  // same specificity, so which one applies depends on the order Tailwind emits them — and the
  // select ended up full-width, pushing itself and the play button out of the row. The width
  // belongs to a wrapper, where `w-full` then means "as wide as the slot I was given".
  it("sizes the sound select from its wrapper, not from a utility racing w-full", () => {
    const w = mountModal({ soundKinds: ["finished"] });
    const select = w.find('select[aria-label="Sound for Turn finished"]');
    expect(select.classes().some((c) => /^w-\d/.test(c))).toBe(false);
    expect(select.element.parentElement?.className).toContain("w-36");
  });

  it("offers a row per notification kind, with the new kinds unticked by default", () => {
    const w = mountModal({ soundKinds: ["finished", "waiting"] });
    expect(w.text()).toContain("Turn finished");
    expect(w.text()).toContain("Command failed");
    expect(w.text()).toContain("PR CI failed");
    const box = (kind: string) => w.find(`input[aria-label="Beep when a session is ${kind}"]`).element as HTMLInputElement;
    expect(box("finished").checked).toBe(true);
    expect(box("command-failed").checked).toBe(false);
  });

  it("emits the whole map, dropping the entry when a kind goes back to the fallback", async () => {
    const w = mountModal({ soundKinds: ["finished", "waiting"], sounds: { finished: "preset:coin", waiting: "preset:gong" } });
    await selectFor(w, "Turn finished").setValue("");
    const emitted = w.emitted("update-sounds");
    expect(emitted?.at(-1)?.[0]).toEqual({ waiting: "preset:gong" });
  });

  // The whole map is persisted on every change, so a second pick made BEFORE the first save
  // answers must build on the first — otherwise it silently reverts it. Props deliberately
  // stay put here: that is what an in-flight POST looks like from the component's side.
  it("keeps an earlier pick when a second is made before the save lands", async () => {
    const w = mountModal({ soundKinds: ["finished", "waiting"], sounds: {} });
    await selectFor(w, "Turn finished").setValue("preset:coin");
    await selectFor(w, "Waiting for you").setValue("preset:meow");
    const emitted = w.emitted("update-sounds");
    expect(emitted?.at(-1)?.[0]).toEqual({ finished: "preset:coin", waiting: "preset:meow" });
  });

  it("emits the kind list in NOTIFY_KINDS order however it was clicked", async () => {
    const w = mountModal({ soundKinds: [] });
    await w.find('input[aria-label="Beep when a session is pr-ci-failed"]').setValue(true);
    await w.find('input[aria-label="Beep when a session is finished"]').setValue(true);
    expect(w.emitted("update-sound-kinds")?.at(-1)?.[0]).toEqual(["finished", "pr-ci-failed"]);
  });

  // Wiring only — what the preview shows for each directory is DirConfigPreview.spec.ts.
  it("hands the directory list to the config preview, and asks for nothing until one is expanded", async () => {
    const w = mountModal({ dirPaths: ["/proj/a", "/proj/b"] });
    await flushPromises();
    expect(w.findAll('[data-testid="dir-preview-row"]')).toHaveLength(2);
  });
});

// Each Settings section that a skill can write hands off to that skill (#1111). The list is
// ENUMERATED from what actually rendered rather than typed out here: a hand-written list is
// agreed with by a check written from the same list, so a button pointing at a skill that
// doesn't ship — or one silently dropped in an edit — passes both (the lesson from #1104's
// guide renumbering).
describe("SettingsModal skill buttons", () => {
  const buttons = (w: ReturnType<typeof mount>) => w.findAllComponents(SkillLaunchButton);

  it("only offers skills that MulmoTerminal ships", () => {
    const skills = buttons(mountModal()).map((b) => b.props("skill"));
    expect(skills.length).toBeGreaterThan(0);
    skills.forEach((skill) => expect(BUNDLED_SKILL_NAMES).toContain(skill));
  });

  // The mapping a user relies on: press the button in the section you are looking at, get the
  // skill that owns those keys. `-config` is the router/audit and belongs to the section that
  // SHOWS a broken setting; the rest own one area each.
  it.each([
    ["Create a theme…", "mulmoterminal-theme"],
    ["Configure appearance…", "mulmoterminal-dirs"],
    ["Explain my settings…", "mulmoterminal-config"],
    ["Configure notifications…", "mulmoterminal-notify"],
    ["Set up shortcuts…", "mulmoterminal-keys"],
  ])("%s launches %s", async (label, skill) => {
    const w = mountModal();
    const button = buttons(w).find((b) => b.props("label") === label);
    if (!button) throw new Error(`no Settings button labelled "${label}"`);
    await button.find("button").trigger("click");
    expect(w.emitted("launch-skill")?.at(-1)?.[0]).toBe(skill);
  });
});

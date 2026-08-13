// The session-note input's Enter and Escape while a Japanese IME candidate is open (#1353). Its own
// file rather than more lines in TerminalCell.spec.ts, which already trips the max-lines warning.
//
// The reported bug: typing れびゅー, converting to レビュー, and pressing Enter to confirm saved the
// UNCONVERTED text and closed the box — the IME's confirm keypress was eaten by saveMemo, and since
// the box was gone there was no second chance.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalCell from "../../../src/components/TerminalCell.vue";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader"],
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-actions" /></div>',
  },
}));

const SESSION = "44444444-4444-4444-4444-444444444444";

let posted: { url: string; text: unknown }[] = [];

beforeEach(() => {
  posted = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/memo")) {
      const text: unknown = init?.body ? (JSON.parse(String(init.body)) as { text: unknown }).text : null;
      posted.push({ url: u, text });
      return { ok: true, json: async () => ({ memo: text }) };
    }
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

function mountCell() {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      initialSessionId: SESSION,
      initialCwd: null,
      defaultCwd: "/home/me/my-project",
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
  });
}

/** Open the note editor and put `text` in it, as the user typing would. */
async function openMemo(w: ReturnType<typeof mountCell>, text: string) {
  await w.find('[data-testid="cell-memo-edit"]').trigger("click");
  await flushPromises();
  const input = w.find('[data-testid="cell-memo-input"]');
  await input.setValue(text);
  return input;
}

const isOpen = (w: ReturnType<typeof mountCell>) => w.find('[data-testid="cell-memo-input"]').exists();

describe("session note: Enter while an IME candidate is open", () => {
  // Chrome and Firefox keep `isComposing` true on the confirming keydown.
  it("neither saves nor closes when the Enter is still composing", async () => {
    const w = mountCell();
    await flushPromises();
    const input = await openMemo(w, "れびゅー");

    await input.trigger("compositionstart");
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    await flushPromises();

    expect(posted).toEqual([]);
    expect(isOpen(w)).toBe(true);
  });

  // Safari fires compositionend BEFORE the confirming keydown, so `isComposing` is already false —
  // the naive guard the rest of this repo uses would let this one save the half-converted text.
  it("neither saves nor closes on the keydown that immediately follows compositionend", async () => {
    const w = mountCell();
    await flushPromises();
    const input = await openMemo(w, "れびゅー");

    await input.trigger("compositionstart");
    await input.trigger("compositionend");
    await input.trigger("keydown", { key: "Enter", isComposing: false });
    await flushPromises();

    expect(posted).toEqual([]);
    expect(isOpen(w)).toBe(true);
  });

  // The whole point: the box is still there, so the user's SECOND Enter saves the converted text.
  it("saves the converted text on the next Enter, once the conversion is settled", async () => {
    const w = mountCell();
    await flushPromises();
    const input = await openMemo(w, "れびゅー");

    await input.trigger("compositionstart");
    await input.trigger("compositionend");
    await input.setValue("レビュー");
    // A human's second press is >= 100ms later; the Safari race window is 30ms.
    await new Promise((r) => setTimeout(r, 50));
    await input.trigger("keydown", { key: "Enter", isComposing: false });
    await flushPromises();

    expect(posted.map((p) => p.text)).toEqual(["レビュー"]);
    expect(isOpen(w)).toBe(false);
  });

  it("still saves on a plain Enter when no IME was involved", async () => {
    const w = mountCell();
    await flushPromises();
    const input = await openMemo(w, "review this");

    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(posted.map((p) => p.text)).toEqual(["review this"]);
    expect(isOpen(w)).toBe(false);
  });
});

describe("session note: Escape while an IME candidate is open", () => {
  // Escape mid-composition means "drop this candidate". Closing the editor on it would throw away
  // the sentence still being written — the same class of bug as the Enter one, one key over.
  it("keeps the editor open when the Escape is still composing", async () => {
    const w = mountCell();
    await flushPromises();
    const input = await openMemo(w, "れびゅー");

    await input.trigger("compositionstart");
    await input.trigger("keydown", { key: "Escape", isComposing: true });
    await flushPromises();

    expect(isOpen(w)).toBe(true);
    expect(posted).toEqual([]);
  });

  it("still closes without saving on a plain Escape", async () => {
    const w = mountCell();
    await flushPromises();
    const input = await openMemo(w, "never mind");

    await input.trigger("keydown", { key: "Escape" });
    await flushPromises();

    expect(isOpen(w)).toBe(false);
    expect(posted).toEqual([]);
  });
});

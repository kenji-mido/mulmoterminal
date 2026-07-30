// The wiring between the activity stream, the beep gate and the missed marks (#1152).
//
// A suspended AudioContext freezes `currentTime`, so every beep scheduled while the browser has
// not unlocked audio is pinned to the same instant and they all fire together on the user's
// first click. These tests drive the real composable against a fake context to pin that nothing
// is scheduled while blocked, that exactly ONE beep goes out on resume, and that the sessions
// nobody was told about are marked.
//
// The player keeps its AudioContext, its held beep and the missed set at module scope (one page,
// one of each), so every test loads a FRESH module graph — otherwise the second test inherits
// the first one's already-running context and proves nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, h, computed } from "vue";
import { mount } from "@vue/test-utils";
import type { SoundConfig } from "../../../src/composables/useAttentionSound";
import type { NotifyKind } from "../../../common/notifyKinds";

const subscribers = new Map<string, (data: unknown) => void>();

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, handler: (data: unknown) => void) => {
      subscribers.set(channel, handler);
      return () => subscribers.delete(channel);
    },
    onReconnect: () => () => {},
  }),
}));

// Enough of an AudioContext to see what the player did: how many sources it started, and what
// state it was in. `currentTime` stays 0 while suspended, exactly like the real one — that
// freeze is the bug being guarded against.
let created: FakeAudioContext | null = null;
const remember = (ctx: FakeAudioContext) => (created = ctx);

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = {};
  started = 0;
  private listeners: (() => void)[] = [];

  constructor() {
    remember(this);
  }
  addEventListener(_type: string, listener: () => void) {
    this.listeners.push(listener);
  }
  resumeCalls = 0;
  async resume() {
    this.resumeCalls += 1;
    this.state = "running";
    this.listeners.forEach((listener) => listener());
  }
  /** What iOS does when the system takes the audio session away. */
  interrupt() {
    this.state = "suspended";
    this.listeners.forEach((listener) => listener());
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (node: unknown) => node };
  }
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => (this.started += 1),
      stop: () => {},
    };
  }
  createBufferSource() {
    return { buffer: null, connect: (node: unknown) => node, start: () => (this.started += 1) };
  }
}

const ALL_KINDS: NotifyKind[] = ["finished", "waiting"];

async function mountPlayer(enabled = true) {
  vi.resetModules();
  const { useAttentionSound } = await import("../../../src/composables/useAttentionSound");
  const { useMissedAttention } = await import("../../../src/composables/useMissedAttention");
  const { audioBlocked } = await import("../../../src/composables/audioUnlockState");
  const on = ref(enabled);
  const kinds = ref<NotifyKind[]>([...ALL_KINDS]);
  const component = defineComponent({
    setup() {
      useAttentionSound(
        on,
        computed<SoundConfig>(() => ({ kinds: kinds.value, sounds: {}, soundFile: null })),
      );
      return () => h("div");
    },
  });
  const wrapper = mount(component);
  // Priming the context is part of the fix, so its absence is a failure rather than a skip.
  if (!created) throw new Error("the player did not create an AudioContext");
  return { wrapper, enabled: on, kinds, ctx: created, isMissed: useMissedAttention().isMissed, audioBlocked };
}

const push = (data: Record<string, unknown>) => subscribers.get("sessions")?.(data);

beforeEach(() => {
  subscribers.clear();
  created = null;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAttentionSound while the browser has not unlocked audio", () => {
  it("reports the block to the toolbar without waiting for a missed notification", async () => {
    const { wrapper, audioBlocked } = await mountPlayer();
    expect(audioBlocked.value).toBe(true);
    wrapper.unmount();
  });

  it("schedules nothing while blocked, so beeps cannot pile up on the frozen clock", async () => {
    const { wrapper, ctx } = await mountPlayer();
    push({ id: "a", working: true, event: "UserPromptSubmit" }); // baseline
    push({ id: "a", working: false, event: "Stop", waiting: true });
    expect(ctx.started).toBe(0);
    wrapper.unmount();
  });

  it("plays exactly ONE beep when the context resumes, however many were held", async () => {
    const { wrapper, ctx } = await mountPlayer();
    push({ id: "a", working: true, event: "UserPromptSubmit" });
    push({ id: "a", working: false, event: "Stop", waiting: true });
    push({ id: "b", working: true, event: "UserPromptSubmit" });
    push({ id: "b", working: false, event: "Stop", waiting: true });
    await ctx.resume();
    // Two notes in one chime figure — a single notification, not one per held beep.
    expect(ctx.started).toBe(2);
    wrapper.unmount();
  });

  it("marks the sessions whose beep was held, so which ones were missed survives the blast", async () => {
    const { wrapper, isMissed } = await mountPlayer();
    push({ id: "a", working: true, event: "UserPromptSubmit" });
    push({ id: "a", working: false, event: "Stop", waiting: true });
    expect(isMissed("a")).toBe(true);
    wrapper.unmount();
  });

  it("drops the held beep when the user turns the sound off", async () => {
    const { wrapper, enabled, ctx } = await mountPlayer();
    push({ id: "a", working: true, event: "UserPromptSubmit" });
    push({ id: "a", working: false, event: "Stop", waiting: true });
    enabled.value = false;
    await wrapper.vm.$nextTick();
    await ctx.resume();
    expect(ctx.started).toBe(0);
    wrapper.unmount();
  });

  it("does not replay a kind the user silenced while it was held", async () => {
    // The held beep is re-checked against the CURRENT settings, not the ones in force when it
    // was held — otherwise turning a moment off during the blocked window still beeps for it.
    const { wrapper, ctx, kinds } = await mountPlayer();
    push({ id: "a", working: true, event: "UserPromptSubmit" });
    push({ id: "a", working: false, event: "Stop", waiting: true }); // holds "finished"
    kinds.value = ["waiting"];
    await wrapper.vm.$nextTick();
    await ctx.resume();
    expect(ctx.started).toBe(0);
    wrapper.unmount();
  });

  it("still replays a kind that is still switched on", async () => {
    const { wrapper, ctx, kinds } = await mountPlayer();
    push({ id: "a", working: true, event: "UserPromptSubmit" });
    push({ id: "a", working: false, event: "Stop", waiting: true });
    kinds.value = ["finished"];
    await wrapper.vm.$nextTick();
    await ctx.resume();
    expect(ctx.started).toBe(2);
    wrapper.unmount();
  });

  it("stops reporting a block once the context runs", async () => {
    const { wrapper, ctx, audioBlocked } = await mountPlayer();
    await ctx.resume();
    expect(audioBlocked.value).toBe(false);
    wrapper.unmount();
  });

  it("holds again — and re-reports the block — if the context is interrupted later", async () => {
    // iOS takes the audio session away for a call, a screen lock or backgrounding.
    const { wrapper, ctx, audioBlocked } = await mountPlayer();
    await ctx.resume();
    ctx.interrupt();
    expect(audioBlocked.value).toBe(true);
    push({ id: "f", working: true, event: "UserPromptSubmit" });
    push({ id: "f", working: false, event: "Stop", waiting: true });
    expect(ctx.started).toBe(0);
    await ctx.resume();
    expect(ctx.started).toBe(2);
    wrapper.unmount();
  });

  it("re-arms the gesture listener after an interruption", async () => {
    // The unlock listener retires itself on the first successful resume. Without re-arming, a
    // context interrupted later can never be resumed again — no gesture reaches it.
    const { wrapper, ctx } = await mountPlayer();
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(ctx.resumeCalls).toBe(1);

    ctx.interrupt();
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(ctx.resumeCalls).toBe(2);
    wrapper.unmount();
  });
});

describe("useAttentionSound once audio plays", () => {
  it("beeps straight away and leaves no mark", async () => {
    const { wrapper, ctx, isMissed } = await mountPlayer();
    await ctx.resume();
    push({ id: "c", working: true, event: "UserPromptSubmit" });
    push({ id: "c", working: false, event: "Stop", waiting: true });
    expect(ctx.started).toBe(2);
    expect(isMissed("c")).toBe(false);
    wrapper.unmount();
  });

  it("marks a session that was ALREADY waiting when the page loaded", async () => {
    // Its first row is baseline-only, so nothing announces it — the reload case, and it happens
    // even with audio working.
    const { wrapper, ctx, isMissed } = await mountPlayer();
    await ctx.resume();
    push({ id: "d", working: false, waiting: true, event: "Notification" });
    expect(isMissed("d")).toBe(true);
    wrapper.unmount();
  });

  it("clears the mark once the session stops asking", async () => {
    const { wrapper, ctx, isMissed } = await mountPlayer();
    await ctx.resume();
    push({ id: "e", working: false, waiting: true, event: "Notification" });
    expect(isMissed("e")).toBe(true);
    push({ id: "e", working: false, waiting: false, event: "Stop" });
    expect(isMissed("e")).toBe(false);
    wrapper.unmount();
  });
});

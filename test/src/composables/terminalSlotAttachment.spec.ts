import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Same doubles as the sibling connection specs (test/helpers/xtermDouble.ts); see the note there
// about why the mock factories import themselves.
const { termState: mockTermState, keyState: mockKeyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());

vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(mockTermState, mockKeyState));
vi.mock("@xterm/addon-fit", async () => (await import("../../helpers/xtermDouble")).fitAddonModule());
vi.mock("@xterm/addon-web-links", async () => (await import("../../helpers/xtermDouble")).webLinksAddonModule());
vi.mock("@xterm/addon-clipboard", async () => (await import("../../helpers/xtermDouble")).clipboardAddonModule());
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import * as conn from "../../../src/composables/useTerminalConnections";
import { FakeWebSocket } from "../../helpers/xtermDouble";

// Whether a slot is attached is not cosmetic bookkeeping: `fit` reads it, and a slot it reads as
// detached stops re-fitting, stops sending the pty a size and stops repainting — so the pty freezes
// at the size it last heard while the browser draws the cell at a new one (#1178).
const KEY = "cell-attach";
const target = { sessionId: null, cwd: "/w", devTerminal: false, command: null, launcher: null };
const resizeFrames = (ws: FakeWebSocket) => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "resize");

describe("slot attachment", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => conn.release(KEY));

  // The ordering this exists for: a view that mounts before the previous one has finished
  // unmounting. The old view's detach names the element IT attached, so the guard can tell that a
  // newer view owns the slot — passing null (which is what a template ref reads as inside
  // `unmounted`) made every such detach unconditional.
  it("does not let a replaced view's detach take the slot from the live one", () => {
    const old = document.createElement("div");
    const live = document.createElement("div");
    conn.attach(KEY, target, {}, old);
    conn.attach(KEY, target, {}, live);

    conn.detach(KEY, old);

    expect(live.childElementCount).toBe(1); // the terminal is still on screen where it was moved
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.sent.length = 0;
    conn.fit(KEY);
    expect(resizeFrames(ws)).toHaveLength(1); // …and still tells the pty its size
  });

  it("still tears the view down when the element that attached it is the one leaving", () => {
    const el = document.createElement("div");
    conn.attach(KEY, target, {}, el);
    conn.detach(KEY, el);
    expect(el.childElementCount).toBe(0);
  });

  // The safety net under the rule above: whatever the bookkeeping says, a terminal whose host is
  // still in the document is attached, and must not be left in a state where nothing ever fits or
  // repaints it again.
  it("re-adopts a slot whose attachment was lost while its terminal is still on screen", () => {
    const el = document.createElement("div");
    document.body.appendChild(el); // on screen is the condition — a detached container is not it
    conn.attach(KEY, target, {}, el);
    const host = el.firstElementChild;
    if (!host) throw new Error("no host attached");

    conn.detach(KEY, null); // bookkeeping cleared…
    el.appendChild(host); // …but the terminal is on screen

    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.sent.length = 0;
    conn.fit(KEY);
    expect(resizeFrames(ws)).toHaveLength(1);
    el.remove();
  });

  // The other half of that rule: a container that has left the document is not somewhere the
  // terminal can be measured, so the slot stays detached rather than pointing at an orphan.
  it("does not adopt a host whose container has left the document", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    conn.attach(KEY, target, {}, el);
    const host = el.firstElementChild;
    if (!host) throw new Error("no host attached");

    conn.detach(KEY, null);
    el.appendChild(host);
    el.remove(); // the whole cell went away with its terminal inside it

    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.sent.length = 0;
    conn.fit(KEY);
    expect(resizeFrames(ws)).toEqual([]);
  });
});

// Slot keys are positional (`cell-<uid>`, renumbered from array position on every grid parse)
// while the slot map outlives components — so a view can be handed a slot another cell filled: an
// HMR reload of GridView, or the ghost a closed cell used to leave. Reusing it silently showed a
// claude cell some earlier shell's terminal and persisted the wrong pairing (#1533). A view that
// names a session gets THAT session or a reconnect; only a view with no opinion keeps the reuse.
describe("a slot inherited by a view asking for a different session", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    conn.release(KEY);
    vi.restoreAllMocks();
  });

  const withSession = (sessionId: string | null) => ({ ...target, sessionId });

  it("reconnects under the requested session instead of reusing the slot's", () => {
    conn.attach(KEY, withSession("shell-1"), {}, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(1);

    const seen: string[] = [];
    conn.attach(KEY, withSession("claude-2"), { onSession: (id) => seen.push(id) }, document.createElement("div"));

    expect(FakeWebSocket.instances).toHaveLength(2); // a new socket, not the inherited one
    expect(FakeWebSocket.instances.at(-1)?.url).toContain("session=claude-2");
    // The replay must not write the inherited session back into the parent's persisted state.
    expect(seen).toEqual(["claude-2"]);
  });

  it("keeps the reuse for the same session", () => {
    conn.attach(KEY, withSession("s-1"), {}, document.createElement("div"));
    conn.attach(KEY, withSession("s-1"), {}, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // The repair path: a parent that never learned the id (persisted `session: null`) remounts and
  // is told the slot's session via the replay. The guard must not turn that into a reconnect.
  it("keeps the reuse, and the replay, for a view with no opinion", () => {
    conn.attach(KEY, withSession("s-1"), {}, document.createElement("div"));
    const seen: string[] = [];
    conn.attach(KEY, withSession(null), { onSession: (id) => seen.push(id) }, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(seen).toEqual(["s-1"]);
  });

  // The same cell paging away and back before its id arrives — the window an auto-start cell
  // (the phone's launch request, #1535) lives in. BOTH sides have no opinion: the slot has not
  // learned an id and the remounted view is a fresh launch, so this must stay the reuse. A
  // reconnect here would spawn a SECOND agent and orphan the first, which is what the cell's
  // relaunch-on-mount was reviewed as doing (CodeRabbit on #1557) — it does not.
  it("keeps the reuse when neither the slot nor the remounted view knows the session yet", () => {
    conn.attach(KEY, withSession(null), {}, document.createElement("div"));
    conn.detach(KEY, null);
    conn.attach(KEY, withSession(null), {}, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // A slot that has not learned an id is not a blank slate (review on #1534): it belongs to a
  // fresh launch whose socket may still be connecting, and its `session` frame — the OLD cell's —
  // would land on whatever view holds the slot. A view naming a concrete session reconnects.
  it("reconnects when the inherited slot has not learned a session yet", () => {
    conn.attach(KEY, withSession(null), {}, document.createElement("div")); // a fresh launch's slot
    expect(FakeWebSocket.instances).toHaveLength(1);
    conn.attach(KEY, withSession("claude-2"), {}, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.at(-1)?.url).toContain("session=claude-2");
  });
});

import { describe, it, expect, vi } from "vitest";
import { createHandlerQueue, type HandlerQueue } from "../../../src/composables/handlerQueue";

describe("createHandlerQueue", () => {
  it("hands a request to the live handler and answers with what it returned", () => {
    const queue = createHandlerQueue<string, boolean>();
    const handler = vi.fn(() => false);
    queue.register(handler);
    expect(queue.deliver("a", true)).toBe(false);
    expect(handler).toHaveBeenCalledWith("a");
  });

  it("queues while nothing is registered and answers with queuedResult", () => {
    const queue = createHandlerQueue<string, boolean>();
    expect(queue.deliver("a", true)).toBe(true);
  });

  // Every waiting request, in arrival order: the callers answer each one with success, so a
  // dropped request is work reported as done that never happened (#831).
  it("drains everything queued, in arrival order, on register", () => {
    const queue: HandlerQueue<string, void> = createHandlerQueue();
    queue.deliver("first", undefined);
    queue.deliver("second", undefined);
    queue.deliver("third", undefined);
    const handler = vi.fn();
    queue.register(handler);
    expect(handler.mock.calls).toEqual([["first"], ["second"], ["third"]]);
  });

  it("hands the handler the request alone — not forEach's index and array", () => {
    const queue: HandlerQueue<string, void> = createHandlerQueue();
    queue.deliver("only", undefined);
    const handler = vi.fn();
    queue.register(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("only");
  });

  it("empties the queue once drained, so a later register replays nothing", () => {
    const queue: HandlerQueue<string, void> = createHandlerQueue();
    queue.deliver("once", undefined);
    queue.register(vi.fn())();
    const second = vi.fn();
    queue.register(second);
    expect(second).not.toHaveBeenCalled();
  });

  // A request made from inside the draining handler (it can reach the opener through the grid)
  // must not be dropped by the clear that follows the drain — which is why the queue is taken
  // and emptied before anything is dispatched.
  it("does not lose a request made from inside the draining handler", () => {
    const queue: HandlerQueue<string, void> = createHandlerQueue();
    queue.deliver("first", undefined);
    const seen: string[] = [];
    queue.register((req) => {
      seen.push(req);
      if (req === "first") queue.deliver("from-handler", undefined);
    });
    expect(seen).toEqual(["first", "from-handler"]);
  });

  it("a stale unregister does not detach a newer handler", () => {
    const queue: HandlerQueue<string, void> = createHandlerQueue();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = queue.register(first);
    queue.register(second);
    offFirst();
    queue.deliver("a", undefined);
    expect(second).toHaveBeenCalledWith("a");
    expect(first).not.toHaveBeenCalled();
  });

  it("reset drops the handler and anything waiting", () => {
    const queue: HandlerQueue<string, void> = createHandlerQueue();
    queue.deliver("waiting", undefined);
    queue.reset();
    const handler = vi.fn();
    queue.register(handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

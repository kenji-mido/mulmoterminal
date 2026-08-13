// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { checkKeymap, enforceKeymap } from "../../../server/config/keymap-check.js";

describe("checkKeymap", () => {
  it("says nothing about a config with no keymap at all — shortcuts are opt-in", () => {
    expect(checkKeymap({})).toEqual({ warnings: [], errors: [] });
    expect(checkKeymap({ keymap: {} })).toEqual({ warnings: [], errors: [] });
    expect(checkKeymap(undefined)).toEqual({ warnings: [], errors: [] });
  });

  it("says nothing about a valid keymap", () => {
    expect(checkKeymap({ keymap: { "zoom-next": "PageDown", "terminal-close": "Shift+Delete" } })).toEqual({ warnings: [], errors: [] });
  });

  it("ERRORS on an unparseable binding, naming the action and the value", () => {
    const { errors, warnings } = checkKeymap({ keymap: { "zoom-next": "Hyper+PageDown" } });
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("zoom-next");
    expect(errors[0]).toContain("Hyper+PageDown");
  });

  it("ERRORS on a non-string binding", () => {
    expect(checkKeymap({ keymap: { "zoom-next": 42 } }).errors).toHaveLength(1);
  });

  it("ERRORS when keymap isn't an object", () => {
    expect(checkKeymap({ keymap: "PageDown" }).errors).toHaveLength(1);
    expect(checkKeymap({ keymap: [] }).errors).toHaveLength(1);
  });

  it("only WARNS about an unknown action — that is what a newer version's config looks like", () => {
    const { errors, warnings } = checkKeymap({ keymap: { "warp-drive": "F1" } });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("warp-drive");
  });

  it("reports every problem at once, not just the first", () => {
    const { errors, warnings } = checkKeymap({ keymap: { "zoom-next": "Hyper+X", "zoom-prev": "Shift+", "warp-drive": "F1" } });
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });
});

// A label only — enforceKeymap never touches the disk (readConfig is injected).
const CONFIG_PATH = "/home/u/.mulmoterminal/config.json";

describe("enforceKeymap", () => {
  const io = (config: unknown) => {
    const warn = vi.fn();
    const fail = vi.fn(() => {
      throw new Error("exited");
    }) as unknown as (m: string) => never;
    return { readConfig: () => config, warn, fail };
  };

  it("does nothing for a valid config", () => {
    const deps = io({ keymap: { "zoom-next": "PageDown" } });
    enforceKeymap(CONFIG_PATH, deps);
    expect(deps.warn).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("fails — refusing to start — on a malformed binding", () => {
    const deps = io({ keymap: { "zoom-next": "Hyper+X" } });
    expect(() => enforceKeymap(CONFIG_PATH, deps)).toThrow("exited");
    expect(deps.fail).toHaveBeenCalledOnce();
    const message = vi.mocked(deps.fail).mock.calls[0][0];
    expect(message).toContain(CONFIG_PATH); // the user must know WHICH file
    expect(message).toContain("Shift+PageUp"); // and what a good binding looks like
  });

  it("warns but STARTS on an unknown action", () => {
    const deps = io({ keymap: { "warp-drive": "F1" } });
    enforceKeymap(CONFIG_PATH, deps);
    expect(deps.warn).toHaveBeenCalledOnce();
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("warns AND fails when both kinds are present", () => {
    const deps = io({ keymap: { "warp-drive": "F1", "zoom-next": "Shift+" } });
    expect(() => enforceKeymap(CONFIG_PATH, deps)).toThrow("exited");
    expect(deps.warn).toHaveBeenCalledOnce();
  });
});

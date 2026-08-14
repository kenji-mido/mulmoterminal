// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  FIRST_WORKTREE_SLOT,
  MAX_PORT,
  MAX_PORT_BASE,
  MAX_PORT_SLOTS,
  MAX_SLUG_CHARS,
  MIN_PORT,
  PORT_SLOT_STRIDE,
  PROJECT_SLOT,
  localUrlForPort,
  portForSlot,
  slugCandidate,
  slugWithSuffix,
  slugifyIdentifier,
  worktreeEnvValue,
} from "../../common/worktreeEnv";

describe("portForSlot", () => {
  it("gives the project's own slot the base itself", () => {
    expect(portForSlot(3000, PROJECT_SLOT)).toBe(3000);
  });

  // The picture from #1367: main on 3000, its worktrees on 3010 / 3020.
  it("spaces worktrees a full stride apart", () => {
    expect(portForSlot(3000, FIRST_WORKTREE_SLOT)).toBe(3010);
    expect(portForSlot(3000, 2)).toBe(3020);
    expect(PORT_SLOT_STRIDE).toBe(10);
  });

  it("refuses a slot outside the usable port range", () => {
    expect(portForSlot(MIN_PORT, -1)).toBeNull();
    expect(portForSlot(MAX_PORT, 1)).toBeNull();
  });

  // The cap on `base` is what makes the null above unreachable for a config the schema accepted:
  // a variable that silently never gets set would be a feature that looks switched off.
  it("keeps every slot in range for the highest base the schema allows", () => {
    const slots = Array.from({ length: MAX_PORT_SLOTS }, (_, slot) => portForSlot(MAX_PORT_BASE, slot));
    expect(slots.every((port) => port !== null)).toBe(true);
  });
});

describe("slugifyIdentifier", () => {
  it("lowercases and folds anything that is not a letter or digit into one underscore", () => {
    expect(slugifyIdentifier("Fix-Login  UI")).toBe("fix_login_ui");
  });

  it("drops the edge underscores a fold leaves behind", () => {
    expect(slugifyIdentifier("--fix-login--")).toBe("fix_login");
  });

  // Postgres and most container runtimes reject an identifier that starts with a digit.
  it("prefixes a name that would start with a digit", () => {
    expect(slugifyIdentifier("1367-ports")).toBe("x1367_ports");
  });

  it("never returns empty", () => {
    expect(slugifyIdentifier("---")).toBe("x");
    expect(slugifyIdentifier("")).toBe("x");
  });
});

describe("slugCandidate", () => {
  it("joins the prefix and the identity, with no suffix on the first attempt", () => {
    expect(slugCandidate("myapp_", "fix-login", 1)).toBe("myapp_fix_login");
  });

  it("suffixes later attempts so a collision has somewhere to go", () => {
    expect(slugCandidate("myapp_", "fix-login", 2)).toBe("myapp_fix_login_2");
  });

  it("stays inside the identifier limit", () => {
    expect(slugCandidate("p_".repeat(40), "fix-login", 1).length).toBeLessThanOrEqual(MAX_SLUG_CHARS);
  });

  // The trap this is written against: truncating AFTER appending would cut `_2` off a long name
  // and hand two directories the same identifier — the one thing the suffix exists to prevent.
  it("keeps the suffix when the name is already at the limit", () => {
    const long = slugCandidate("p".repeat(MAX_SLUG_CHARS + 20), "x", 2);
    expect(long.length).toBeLessThanOrEqual(MAX_SLUG_CHARS);
    expect(long.endsWith("_2")).toBe(true);
    expect(long).not.toBe(slugCandidate("p".repeat(MAX_SLUG_CHARS + 20), "x", 1));
  });
});

describe("slugWithSuffix", () => {
  // The rule slugCandidate is built on, stated on its own because getting it backwards is what
  // made the 100th colliding directory share the 1st one's name (Codex review on #1367): the STEM
  // gets cut to make room, so the suffix always survives — even against a prefix already at the
  // length limit, where truncating the finished string would eat the suffix whole.
  it("keeps the suffix when the prefix alone already fills the limit", () => {
    const prefix = "p".repeat(MAX_SLUG_CHARS);
    const a = slugWithSuffix(prefix, "x", "_a1b2c3d4");
    const b = slugWithSuffix(prefix, "x", "_e5f6a7b8");
    expect(a).not.toBe(b);
    expect(a.endsWith("_a1b2c3d4")).toBe(true);
    expect(a).toHaveLength(MAX_SLUG_CHARS);
  });

  it("is what slugCandidate's numbered attempts are made of", () => {
    expect(slugCandidate("myapp_", "fix-login", 3)).toBe(slugWithSuffix("myapp_", "fix-login", "_3"));
    expect(slugCandidate("myapp_", "fix-login", 1)).toBe(slugWithSuffix("myapp_", "fix-login", ""));
  });
});

describe("worktreeEnvValue", () => {
  it("gives a port the url that opens it", () => {
    expect(worktreeEnvValue("PORT", "3010", "port")).toEqual({ name: "PORT", value: "3010", url: "http://localhost:3010" });
    expect(localUrlForPort(3010)).toBe("http://localhost:3010");
  });

  // A slug is a database name, not something a browser can open — a link there would 404.
  it("gives a slug no url", () => {
    expect(worktreeEnvValue("DB_NAME", "myapp_fix_login", "slug")).toEqual({ name: "DB_NAME", value: "myapp_fix_login", url: null });
  });
});

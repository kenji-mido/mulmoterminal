import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WorktreeEnvChip from "../../../src/components/WorktreeEnvChip.vue";
import type { WorktreeEnvValue } from "../../../common/worktreeEnv";

const render = (values: WorktreeEnvValue[]) => mount(WorktreeEnvChip, { props: { values } });
const port = (value: string): WorktreeEnvValue => ({ name: "PORT", value, url: `http://localhost:${value}` });
const slug = (value: string): WorktreeEnvValue => ({ name: "DB_NAME", value, url: null });

describe("WorktreeEnvChip", () => {
  // Every cell asks for this chip by default, so a project that declares no `worktreeEnv` must
  // get nothing at all — not an empty pill taking header space in six cells.
  it("renders nothing when the directory holds no values", () => {
    expect(render([]).find('[data-testid="worktree-env-chip"]').exists()).toBe(false);
  });

  it("shows a port as a bare `:3010`", () => {
    expect(
      render([port("3010")])
        .find('[data-testid="worktree-env-value"]')
        .text(),
    ).toBe(":3010");
  });

  it("links a port at the dev server it names", () => {
    const link = render([port("3010")]).find('[data-testid="worktree-env-value"]');
    expect(link.attributes("href")).toBe("http://localhost:3010");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener");
  });

  // A database name is not something a browser can open, so it must not look clickable.
  it("shows a slug as plain text with no href", () => {
    const entry = render([slug("myapp_fix_login")]).find('[data-testid="worktree-env-value"]');
    expect(entry.text()).toBe("myapp_fix_login");
    expect(entry.attributes("href")).toBeUndefined();
  });

  // `:3010` alone does not say WHICH variable it is, and a project can declare several ports.
  it("names the variable on the hover title", () => {
    expect(
      render([port("3010")])
        .find('[data-testid="worktree-env-value"]')
        .attributes("title"),
    ).toBe("PORT=3010");
  });

  it("shows every value the tree holds", () => {
    const w = render([port("3010"), slug("myapp_fix_login")]);
    expect(w.findAll('[data-testid="worktree-env-value"]').map((e) => e.text())).toEqual([":3010", "myapp_fix_login"]);
  });
});

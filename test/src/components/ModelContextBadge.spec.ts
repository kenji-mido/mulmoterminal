import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ModelContextBadge from "../../../src/components/ModelContextBadge.vue";

// Wiring only — which window a model has, and what the badge says when we cannot know, is decided
// in src/components/modelBadge.ts and tested in modelBadge.spec.ts without mounting anything.
function mountBadge(props: { agent?: "claude" | "codex"; model: string | null; contextTokens?: number }) {
  return mount(ModelContextBadge, {
    props: { agent: props.agent ?? "claude", model: props.model, contextTokens: props.contextTokens ?? 0 },
  });
}

describe("ModelContextBadge", () => {
  // The reading moved from a `title` to the shared hover tip (#1235): the browser's tooltip could
  // not be made to appear promptly, and its one line had nowhere to put the full model name. What
  // the tip says is pinned in tipContent.spec.ts; what matters here is that the attribute is GONE,
  // or the old slow tooltip would surface a second time on top of the new one.
  it("renders the badge text and no longer carries a native tooltip", () => {
    const badge = mountBadge({ model: "claude-opus-4-20250514", contextTokens: 70_000 }).find('[data-testid="model-badge"]');
    expect(badge.text()).toBe("Opus · ctx 35%");
    expect(badge.attributes("title")).toBeUndefined();
  });

  it("renders nothing when the model is unknown/null (no transcript model yet)", () => {
    expect(mountBadge({ model: null, contextTokens: 1000 }).find("span").exists()).toBe(false);
  });
});

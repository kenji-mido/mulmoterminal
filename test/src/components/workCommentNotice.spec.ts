// Telling the user their issue is not being updated (#1369). Two things decide what they see:
// which causes are still worth showing (module state, shared by every cell), and that each cause
// names its own fix rather than one shrug for all four.
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import WorkCommentNotice from "../../../src/components/WorkCommentNotice.vue";
import {
  clearWorkCommentDismissals,
  dismissWorkCommentFailure,
  visibleWorkCommentFailure,
  workCommentNoticeText,
} from "../../../src/composables/workCommentNotice";
import type { WorkCommentFailure } from "../../../common/workCommentFailure";

const ALL: WorkCommentFailure[] = ["cli-missing", "auth", "permission", "unknown"];

beforeEach(() => clearWorkCommentDismissals());

describe("visibleWorkCommentFailure", () => {
  it("shows nothing when nothing failed", () => {
    expect(visibleWorkCommentFailure(null)).toBeNull();
  });

  it("shows a cause the user has not dismissed", () => {
    expect(visibleWorkCommentFailure("permission")).toBe("permission");
  });

  // The state is shared on purpose: one login produces one cause, and every open cell polling the
  // same repository hits it. Nine chips for one problem is why this is not per-cell.
  it("stays dismissed for every cell, not just the one that was clicked", () => {
    dismissWorkCommentFailure("permission");
    expect(visibleWorkCommentFailure("permission")).toBeNull();
  });

  // Different causes have different fixes — logging in does not grant write access — so silencing
  // one must not silence the next.
  it("still reports a different cause after one is dismissed", () => {
    dismissWorkCommentFailure("auth");
    expect(visibleWorkCommentFailure("permission")).toBe("permission");
  });

  it("does not stack a repeated dismissal", () => {
    dismissWorkCommentFailure("auth");
    dismissWorkCommentFailure("auth");
    expect(visibleWorkCommentFailure("auth")).toBeNull();
  });
});

describe("workCommentNoticeText", () => {
  it("gives every cause a label and a hover", () => {
    ALL.forEach((failure) => {
      const notice = workCommentNoticeText(failure);
      expect(notice.label.length).toBeGreaterThan(0);
      expect(notice.title.length).toBeGreaterThan(0);
    });
  });

  // A shared shrug would send the reader to check an install, a login and a permission grant when
  // only one of them is the answer.
  it("does not word two causes the same", () => {
    const labels = new Set(ALL.map((failure) => workCommentNoticeText(failure).label));
    expect(labels.size).toBe(ALL.length);
  });

  // The hover is where the fix goes, and each fix is a different command or a different ask.
  it("names the fix for the causes that have one", () => {
    expect(workCommentNoticeText("auth").title).toContain("gh auth login");
    expect(workCommentNoticeText("permission").title).toContain("write");
    expect(workCommentNoticeText("cli-missing").title).toContain("install");
  });

  // Nothing is broken — the work carries on and only the comment was skipped. A notice that read
  // like an error would send someone looking for damage that is not there.
  it("says the work is unaffected when it cannot explain more", () => {
    expect(workCommentNoticeText("unknown").title).toContain("work is unaffected");
  });
});

describe("WorkCommentNotice", () => {
  it("renders the cause it was given", () => {
    const wrapper = mount(WorkCommentNotice, { props: { failure: "permission" } });
    expect(wrapper.get('[data-testid="work-comment-notice-label"]').text()).toBe(workCommentNoticeText("permission").label);
    expect(wrapper.get('[data-testid="work-comment-notice"]').attributes("title")).toBe(workCommentNoticeText("permission").title);
  });

  it("asks to be dismissed rather than dismissing itself", () => {
    const wrapper = mount(WorkCommentNotice, { props: { failure: "auth" } });
    wrapper.get('[data-testid="work-comment-notice-dismiss"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });
});

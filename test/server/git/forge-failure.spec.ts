// @vitest-environment node
// Why a work comment could not be written (#1369).
//
// Every input below is REAL output, captured by running the CLIs on a developer machine — not
// wording invented to match the implementation. That matters more here than in most specs: the
// whole function is a claim about what `gh` and `glab` print, and a spec written from the same
// guess as the code would agree with it and still be wrong.
//
// The write cases were captured with a deliberately invalid token, so the commands failed at
// authentication and nothing was ever posted to the repositories named in them.
import { describe, it, expect } from "vitest";
import { classifyForgeFailure } from "../../../server/git/forge-failure";
import { GH_MISSING_STDERR } from "../../../server/git/gh";
import { GLAB_MISSING_STDERR } from "../../../server/git/glab";

// `gh issue comment` / `gh issue close` go through GraphQL and print the status FIRST, with a
// colon. `gh api` and `glab api` print it LAST, in parentheses. Nothing else about the two is
// alike, which is why the status — not the English — is what gets read.
const GH_API_401 = "gh: Bad credentials (HTTP 401)";
const GH_ISSUE_401 = "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login";
const GH_API_403 = "gh: Must have push access to view repository collaborators. (HTTP 403)";
const GH_API_404 = "gh: Not Found (HTTP 404)";
const GLAB_API_401 = "glab: 401 Unauthorized (HTTP 401)";
// No status at all: `gh` declines to call the API and invites you to log in instead. This is the
// ordinary logged-out case, so a status-only reading would file the commonest cause as `unknown`.
const GH_LOGGED_OUT =
  "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.";

describe("classifyForgeFailure", () => {
  it("reads 401 as something the user can log in to fix, in either spelling", () => {
    expect(classifyForgeFailure(GH_API_401)).toBe("auth");
    expect(classifyForgeFailure(GH_ISSUE_401)).toBe("auth");
    expect(classifyForgeFailure(GLAB_API_401)).toBe("auth");
  });

  it("reads a logged-out CLI as auth even with no HTTP status to go on", () => {
    expect(classifyForgeFailure(GH_LOGGED_OUT)).toBe("auth");
  });

  // The cause this whole file exists for: the login works and still may not write.
  it("reads 403 as a permission the login does not have", () => {
    expect(classifyForgeFailure(GH_API_403)).toBe("permission");
  });

  // Deliberately NOT permission. The issue was read successfully moments earlier, so a 404 on the
  // write is as likely to be a comment someone deleted — and naming the wrong fix is worse than
  // naming none.
  it("does not guess at 404", () => {
    expect(classifyForgeFailure(GH_API_404)).toBe("unknown");
  });

  it("tells a CLI that never started from one the forge refused", () => {
    expect(classifyForgeFailure(GH_MISSING_STDERR)).toBe("cli-missing");
    expect(classifyForgeFailure(GLAB_MISSING_STDERR)).toBe("cli-missing");
  });

  // The install hint inside those sentinels names `gh auth login`, which is also the marker for
  // the logged-out case. Order decides it, and this is what pins the order.
  it("does not read the install hint as a login problem", () => {
    expect(GH_MISSING_STDERR).toContain("gh auth login");
    expect(classifyForgeFailure(GH_MISSING_STDERR)).not.toBe("auth");
  });

  it("says unknown rather than inventing a fix", () => {
    expect(classifyForgeFailure("")).toBe("unknown");
    expect(classifyForgeFailure("gh: connection refused")).toBe("unknown");
    expect(classifyForgeFailure("gh: API rate limit exceeded (HTTP 429)")).toBe("unknown");
    expect(classifyForgeFailure("gh: Server Error (HTTP 500)")).toBe("unknown");
  });

  // A repository URL in the message must not be mined for digits that look like a status.
  it("does not read a status out of a URL", () => {
    expect(classifyForgeFailure("gh: failed to run git: https://example.com/HTTP403/x")).toBe("unknown");
  });
});

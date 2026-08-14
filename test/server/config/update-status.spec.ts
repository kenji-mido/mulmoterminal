// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UpdateStatus } from "../../../common/updateStatus.js";

type UpdateInfo = Omit<UpdateStatus, "ready">;
type InstallInfo = Pick<UpdateStatus, "install" | "version" | "commit">;

// vi.mock is hoisted above imports, so the doubles it returns must be created inside a
// vi.hoisted block rather than referencing top-level consts (which aren't initialized yet).
const { computeUpdateInfo, readInstallInfo, isUpdateCheckDisabled } = vi.hoisted(() => ({
  computeUpdateInfo: vi.fn<(pkgDir: string, version: string) => Promise<UpdateInfo>>(),
  readInstallInfo: vi.fn<(pkgDir: string, version: string) => Promise<InstallInfo>>(),
  isUpdateCheckDisabled: vi.fn<(env: Record<string, string | undefined>) => boolean>(),
}));
vi.mock("../../../bin/update-check.js", () => ({ computeUpdateInfo, readInstallInfo, isUpdateCheckDisabled }));

import { refreshUpdateStatus, getUpdateStatus } from "../../../server/config/update-status.js";

const gitInfo: UpdateInfo = {
  install: "git",
  version: "4.7.0",
  commit: "a1b2c3d",
  latest: null,
  notice: "Update available: a1b2c3d → origin  ·  run: git pull",
};

beforeEach(() => {
  computeUpdateInfo.mockReset();
  readInstallInfo.mockReset();
  isUpdateCheckDisabled.mockReset();
});

describe("refreshUpdateStatus", () => {
  it("caches the whole computed status for the route to serve", async () => {
    isUpdateCheckDisabled.mockReturnValue(false);
    computeUpdateInfo.mockResolvedValue(gitInfo);
    await refreshUpdateStatus();
    expect(getUpdateStatus()).toEqual({ ready: true, ...gitInfo });
  });

  // "Up to date" and "not finished yet" are both a null notice, so `ready` is what tells them
  // apart — without it the client cannot know a commit is never coming.
  it("marks the status ready even when there is nothing to report", async () => {
    isUpdateCheckDisabled.mockReturnValue(false);
    computeUpdateInfo.mockResolvedValue({ install: "npm", version: "4.7.0", commit: null, latest: null, notice: null });
    await refreshUpdateStatus();
    expect(getUpdateStatus()).toEqual({ ready: true, install: "npm", version: "4.7.0", commit: null, latest: null, notice: null });
  });

  // The opt-out silences the notice, not the version display: the local read still runs, so a
  // user who turned the nagging off can still read which build they are on.
  it("still reports the running install when opted out, without checking for an update", async () => {
    isUpdateCheckDisabled.mockReturnValue(true);
    readInstallInfo.mockResolvedValue({ install: "git", version: "4.7.0", commit: "a1b2c3d" });
    await refreshUpdateStatus();
    expect(getUpdateStatus()).toEqual({ ready: true, install: "git", version: "4.7.0", commit: "a1b2c3d", latest: null, notice: null });
    expect(computeUpdateInfo).not.toHaveBeenCalled();
  });

  // A thrown check must not surface — the status just keeps its last value.
  it("does not throw when the check rejects", async () => {
    isUpdateCheckDisabled.mockReturnValue(false);
    computeUpdateInfo.mockResolvedValue(gitInfo);
    await refreshUpdateStatus();
    computeUpdateInfo.mockRejectedValue(new Error("offline"));
    await expect(refreshUpdateStatus()).resolves.toBeUndefined();
    expect(getUpdateStatus()).toEqual({ ready: true, ...gitInfo });
  });
});

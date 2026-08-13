// @vitest-environment node
// What a standalone MulmoTerminal registers with the scheduler.
//
// Pinned by id, not by count: the calendar sync was absent for months with nothing to notice
// (#1191), because index.ts built the list inline and no spec could read it.
import { describe, it, expect } from "vitest";

import { buildSystemTasks } from "../../../server/backends/system-tasks.js";

const WORKLOG_OFF = { enabled: false, intervalHours: 6 };
const build = (worklog = WORKLOG_OFF) => buildSystemTasks({ workspaceRoot: "/ws", worklog, spawnChat: () => {} });

describe("buildSystemTasks", () => {
  it("registers both shared engines", () => {
    const ids = build().map((task) => task.id);
    expect(ids).toContain("system:feed-refresh");
    expect(ids).toContain("system:google-calendar-sync");
  });

  // Off is the default, so the list must not carry a null through to registerTask.
  it("leaves the worklog out until it is enabled", () => {
    expect(build().map((task) => task.id)).not.toContain("system.worklog");
    expect(build({ enabled: true, intervalHours: 6 }).map((task) => task.id)).toContain("system.worklog");
  });

  it("returns no nulls", () => {
    expect(build().every(Boolean)).toBe(true);
  });
});

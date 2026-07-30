import { onBeforeUnmount } from "vue";
import { isRecord } from "../../common/isRecord";
import { TOOL_GROUPS_CHANNEL } from "../toolGroupsChannel";
import { usePubSub } from "./usePubSub";

// What the server announces once a session's MCP client has connected.
//
// `groups` is absent on the bare "my client is up" announcement, which is sent for EVERY session —
// including an all-tools one, which has no groups to report — so a missing `groups` must never be
// read as an empty list: that would tell a cell that can draw that it cannot. Undefined and `[]`
// are different answers here, which is why this parses rather than defaults.
export interface ToolGroupsAnnouncement {
  sessionId: string;
  groups?: string[] | undefined;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function toAnnouncement(data: unknown): ToolGroupsAnnouncement | null {
  if (!isRecord(data) || typeof data.sessionId !== "string" || !data.sessionId) return null;
  return isStringArray(data.groups) ? { sessionId: data.sessionId, groups: data.groups } : { sessionId: data.sessionId };
}

// Subscribe for as long as the calling component lives.
//
// Three surfaces ask what a session's tools are when they mount — the grid's Canvas button, the GUI
// panel's tool hint, the tools pane — and all three ask BEFORE the agent's MCP client has connected,
// because the browser is handed a session id while the agent is still being spawned. That first
// "nothing" then stood until something happened to remount the pane. This announcement is the one
// signal that says to ask again; each caller decides what re-asking means for it.
export function onToolGroupsAnnounced(handler: (announcement: ToolGroupsAnnouncement) => void): void {
  const { subscribe } = usePubSub();
  const off = subscribe(TOOL_GROUPS_CHANNEL, (data) => {
    const announcement = toAnnouncement(data);
    if (announcement) handler(announcement);
  });
  onBeforeUnmount(off);
}

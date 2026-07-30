// startChat command handler.
//
// Start a visible chat from the phone, seeded with `message`. This host has no roles, so a `role`
// param is ignored. Optional `attachments` ([{ storage_id }]) are downloaded into the workspace and
// referenced by path in the seeded prompt (the PTY claude reads them via its Read tool). Ingest
// BEFORE spawning so a download failure rejects the command instead of starting a chat missing its
// files.
import { type CommandHandlers, type JsonObject, type JsonValue } from "@mulmoclaude/core/remote-host";
import type { Attachment } from "../ingestAttachments.js";
import type { RemoteHostHandlerDeps } from "./deps.js";

// Parse the optional `attachments` param ([{ storage_id }]) into storage ids. A malformed shape
// rejects the whole command: the remote already uploaded the bytes and is waiting, so a surfaced
// error beats a chat missing its file.
const readStorageIds = (attachments: JsonValue | undefined): string[] => {
  if (attachments == null) return [];
  if (!Array.isArray(attachments)) throw new Error("attachments must be an array of { storage_id }");
  return attachments.map((entry) => {
    const storageId = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.storage_id : undefined;
    if (typeof storageId !== "string" || storageId.length === 0) throw new Error("each attachments entry must be { storage_id: string }");
    return storageId;
  });
};

// The PTY-driven `claude` can't take image content blocks, so reference the saved files by their
// workspace path in the seeded prompt — claude reads them with its Read tool (its cwd is the
// workspace).
const composeMessage = (message: string, attachments: Attachment[]): string => {
  if (attachments.length === 0) return message;
  const paths = attachments.map((file) => file.path).join("\n");
  return `${message}\n\nAttached file(s) — read them from the workspace:\n${paths}`;
};

type StartChatDeps = Pick<RemoteHostHandlerDeps, "spawnChat" | "ingest">;

export const createStartChat =
  ({ spawnChat, ingest }: StartChatDeps): CommandHandlers["startChat"] =>
  async (params: JsonObject) => {
    const message = (typeof params.message === "string" ? params.message : "").trim();
    if (!message) throw new Error("message is required");
    const { attachments, cleanupStaging } = await ingest(readStorageIds(params.attachments));
    // Spawn FIRST, reap staging only after it succeeds: a spawn failure (e.g. a missing
    // provider token) must leave the staged uploads intact so the phone can retry the same
    // command — deleting them before spawn would strand a retry with no bytes to re-fetch.
    const { chatId } = spawnChat(composeMessage(message, attachments));
    // The chat HAS started; staging cleanup is best-effort background work that must never
    // turn a successful start into a reported failure (which the phone would retry, spawning
    // a duplicate chat). Isolate any rejection at this boundary.
    await cleanupStaging().catch((err) => console.warn("[remote-host] staging cleanup after startChat failed", String(err)));
    return { started: true, chatId };
  };

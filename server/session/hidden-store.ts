// Sessions the user hid from the chat sidebar. The sidebar lists on-disk transcripts so an
// exited session lingers (it's resumable) — hiding removes it from the list WITHOUT deleting
// the transcript, so `claude --resume` still has it. Persisted at ~/.mulmoterminal/
// hidden-sessions.json so a hide survives a restart.
//
// Separate from registry's `hiddenSessions` (in-memory, background-worker spawns): that one is
// per-process and about never-surface workers; this is a durable user choice about the list.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../files/atomic-write.js";

const FILE = path.join(os.homedir(), ".mulmoterminal", "hidden-sessions.json");

function load(): Set<string> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set(); // missing / unreadable → nothing hidden
  }
}

const hidden = load();

// Atomic (temp + rename) and best-effort — a failed persist just means the hide doesn't
// survive a restart; the in-memory set already reflects it for this process.
function save(): void {
  writeFileAtomic(FILE, JSON.stringify([...hidden])).catch(() => {});
}

export function isUserHidden(id: string): boolean {
  return hidden.has(id);
}

export function hideSessionId(id: string): void {
  if (!hidden.has(id)) {
    hidden.add(id);
    save();
  }
}

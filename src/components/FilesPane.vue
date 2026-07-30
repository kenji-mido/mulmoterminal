<script setup lang="ts">
// The file explorer + editor itself, independent of where it is shown: the full-screen
// Files view (FilesOverlay) and the pane beside a zoomed grid cell mount the same thing.
// Left: a lazy-loaded directory tree rooted at `cwd`. Right: a CodeMirror editor, with a
// Markdown preview toggle that reuses the server's sandboxed md→HTML iframe. Writes go
// through PUT .../write, whose `path` the server contains within the project root.
//
// It owns no notion of routes or of being open — the host decides when it exists, and
// calls `reload()` after a root change it has already cleared with the user.
import { onBeforeUnmount, onMounted, ref, computed, nextTick, watch } from "vue";
import { createEditor, langKindForFilename, type CmEditor } from "./cmEditor";
import { expandedPaths, restoreOrder } from "./filesTreeState";
import { isWriteToOpenFile } from "../composables/fileWriteMatch";
import { usePubSub } from "../composables/usePubSub";
import { FILE_WRITE_CHANNEL, isFileWriteEvent } from "../../common/fileWriteChannel";

interface Node {
  name: string;
  path: string; // relative to the project root
  dir: boolean;
  size: number;
  expanded: boolean;
  loaded: boolean;
  children: Node[];
}
interface Entry {
  name: string;
  dir: boolean;
  size: number;
}

/** What a host hands back so a revisited directory looks the way it was left. */
export interface FilesPaneState {
  openPath: string | null;
  expanded: string[];
}

const props = defineProps<{ cwd: string | null; requestedPath?: string | null; initialState?: FilesPaneState | null }>();
const emit = defineEmits<{ close: []; dirty: [boolean] }>();

const roots = ref<Node[]>([]);
const treeError = ref<string | null>(null);
const openPath = ref<string | null>(null);
const openName = computed(() => (openPath.value ? (openPath.value.split("/").pop() ?? "") : ""));
const dirty = ref(false);
const saving = ref(false);
const fileError = ref<string | null>(null);
// The version the open buffer was loaded from; sent back on save so the server can refuse a
// write that would clobber someone else's (null = the file didn't exist).
const baseVersion = ref<string | null>(null);
// Set when a save came back 409, holding the version now on disk — what "Overwrite" re-sends.
const conflict = ref<{ version: string | null } | null>(null);
const showPreview = ref(false);
const isMarkdown = computed(() => langKindForFilename(openName.value) === "markdown");

const editorHost = ref<HTMLDivElement>();
let editor: CmEditor | null = null;
// The tree and the open file are fetched independently, so they get a counter EACH. One
// shared counter reads as "latest request wins" and is wrong the moment the two overlap:
// opening a file while the tree is still loading bumped the shared id, the tree's own
// `id === reqId` check then failed, and its result was thrown away — leaving a pane that says
// "Empty directory." next to the file it just opened. Nothing overlapped them until a click in
// terminal output could open a file at the same moment the pane mounts (#910).
let treeReqId = 0;
let fileReqId = 0;

// The host guards its own navigation on this, so it has to hear every change.
watch(dirty, (value) => emit("dirty", value));

function qs(pathRel: string): string {
  const p = new URLSearchParams();
  if (props.cwd) p.set("cwd", props.cwd);
  p.set("path", pathRel);
  return p.toString();
}
const previewSrc = computed(() => (openPath.value ? `/api/files/browse/md?${qs(openPath.value)}` : ""));

function makeNode(e: Entry, parentPath: string): Node {
  return { name: e.name, path: parentPath ? `${parentPath}/${e.name}` : e.name, dir: e.dir, size: e.size, expanded: false, loaded: false, children: [] };
}

async function fetchEntries(pathRel: string): Promise<Entry[]> {
  const res = await fetch(`/api/files/browse/list?${qs(pathRel)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

async function loadRoot(): Promise<void> {
  const id = ++treeReqId;
  treeError.value = null;
  try {
    const entries = await fetchEntries("");
    if (id === treeReqId) roots.value = entries.map((e) => makeNode(e, ""));
  } catch (e) {
    if (id === treeReqId) treeError.value = e instanceof Error ? e.message : String(e);
  }
}

async function toggleDir(node: Node): Promise<void> {
  node.expanded = !node.expanded;
  if (node.expanded && !node.loaded) {
    try {
      node.children = (await fetchEntries(node.path)).map((e) => makeNode(e, node.path));
      node.loaded = true;
    } catch {
      node.expanded = false; // couldn't read — collapse again
    }
  }
}

// Depth-first flatten of the currently-visible rows (only descending into expanded
// dirs), so the template renders a flat list without a recursive component.
const rows = computed(() => {
  const out: { node: Node; depth: number }[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.dir && node.expanded) walk(node.children, depth + 1);
    }
  };
  walk(roots.value, 0);
  return out;
});

type WriteOutcome = { status: "saved"; version: string | null } | { status: "conflict"; version: string | null } | { status: "error"; message: string };

// One write, reported as a value rather than through component state. Leaving has to keep
// working while the pane is being torn down, and anything read from `editor` or a ref AFTER
// an await may already be gone by then.
async function writeBuffer(pathRel: string, text: string, base: string | null, keepalive = false): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/files/browse/write?${qs(pathRel)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, baseVersion: base }),
      keepalive,
    });
    const data = await res.json().catch(() => ({}));
    const version = typeof data.version === "string" ? data.version : null;
    if (res.status === 409) return { status: "conflict", version };
    if (!res.ok) return { status: "error", message: data.error || `HTTP ${res.status}` };
    return { status: "saved", version };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Hand a copy to the backup store — content that exists nowhere else once the editor is gone. */
async function bankText(pathRel: string, text: string, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch(`/api/files/browse/backup?${qs(pathRel)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Save on the way out instead of asking. The editor sits beside a terminal the user is
// working in, so anything that moves the enlargement — a key, a click on the filmstrip —
// would otherwise raise a dialog mid-flow. Nothing is lost either way: the server banks
// three generations of every file it replaces.
//
// A save that loses the version race can't put a banner up (we are already leaving), so the
// buffer is banked instead and the file left as the other writer left it. Everything needed
// is read BEFORE the first await, so an unmount mid-flight can't take the content with it.
// Returns whether the buffer is safe to leave behind — false when NEITHER the save nor the
// backup landed (the server is down, the disk is full). Callers that can stay must stay: with
// no copy anywhere, walking away is the one outcome that loses what was typed.
async function flush(): Promise<boolean> {
  if (!dirty.value || !openPath.value || !editor) return true;
  const pathRel = openPath.value;
  const text = editor.getDoc();
  const outcome = await writeBuffer(pathRel, text, baseVersion.value);
  if (outcome.status !== "saved" && !(await bankText(pathRel, text))) {
    fileError.value = outcome.status === "error" ? outcome.message : "could not save or back up this file";
    return false;
  }
  dirty.value = false;
  conflict.value = null;
  return true;
}

async function openFile(node: Node): Promise<void> {
  if (node.dir) return toggleDir(node);
  await loadFile(node.path);
}

// Open a project-relative path in the editor. Split out from openFile because the other way
// in has no tree node to hand over: a clicked source path in terminal output arrives as
// ?path= and opens the same file (#808).
// `force` re-reads the file already open and skips the unsaved-edits prompt — the
// conflict banner's "Reload", where discarding is the button the user just pressed.
async function loadFile(pathRel: string, force = false): Promise<void> {
  if (!force) {
    if (pathRel === openPath.value) return; // already open — no reload
    // Opening another file is leaving this one. If it couldn't be saved OR banked, staying is
    // the only way not to lose it.
    if (!(await flush())) return;
  }
  const id = ++fileReqId;
  fileError.value = null;
  conflict.value = null;
  showPreview.value = false;
  try {
    const res = await fetch(`/api/files/browse/text?${qs(pathRel)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const data = await res.json();
    if (id !== fileReqId) return;
    openPath.value = pathRel;
    baseVersion.value = typeof data.version === "string" ? data.version : null;
    editor?.setDoc(typeof data.text === "string" ? data.text : "", pathRel.split("/").pop() ?? pathRel);
    dirty.value = false;
  } catch (e) {
    if (id === fileReqId) fileError.value = e instanceof Error ? e.message : String(e);
  }
}

async function save(): Promise<void> {
  if (!openPath.value || !editor || saving.value) return;
  saving.value = true;
  fileError.value = null;
  const outcome = await writeBuffer(openPath.value, editor.getDoc(), baseVersion.value);
  saving.value = false;
  // 409: the file moved on under us (the agent working in this very directory is the likeliest
  // author). Nothing was written — offer the choice instead of picking a loser.
  if (outcome.status === "conflict") {
    conflict.value = { version: outcome.version };
    return;
  }
  if (outcome.status === "error") {
    fileError.value = outcome.message;
    return;
  }
  baseVersion.value = outcome.version;
  dirty.value = false;
  conflict.value = null;
}

/** Conflict banner — take the disk's copy. The buffer is banked first, so "discard" costs
 *  nothing that can't be fetched back out of the backup store. */
async function discardAndReload(): Promise<void> {
  if (!openPath.value || !editor) return;
  // "Kept as a backup either way" is the promise the banner makes. If the store refuses it,
  // the honest answer is to keep the buffer rather than discard it anyway.
  if (!(await bankText(openPath.value, editor.getDoc()))) {
    fileError.value = "could not back up your version — nothing was discarded";
    return;
  }
  loadFile(openPath.value, true);
}

/** Conflict banner — keep the buffer, adopting the disk's version as the new baseline so the
 *  retry is a deliberate overwrite rather than another conflict. */
function overwrite(): void {
  if (!conflict.value) return;
  baseVersion.value = conflict.value.version;
  conflict.value = null;
  save();
}

async function requestClose(): Promise<void> {
  if (await flush()) emit("close");
}

// Bound to this pane's own subtree, not to window: with a pane open beside a terminal,
// a window-level ⌘S would save while the user is typing into the terminal.
function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
}

// The file may move under the editor at any moment — the agent working in this directory is
// editing the same files. Two ways of finding out, because neither alone is enough: the write
// hook is immediate but only speaks for Claude (Codex reports through a different channel, and
// git, a build or another editor report through none), while the poll misses nothing and is
// merely late. The 409 on save is still the hard guarantee; these two only get the news out
// before the user has typed into a file that already moved.
const EXTERNAL_CHECK_MS = 30_000;
let externalTimer: ReturnType<typeof setInterval> | null = null;

/** Re-read the version and react: a clean buffer just takes the new content (the pane reads as
 *  a live view), a dirty one raises the banner rather than choosing for the user. */
async function checkForExternalChange(): Promise<void> {
  if (!openPath.value || saving.value || conflict.value) return;
  const pathRel = openPath.value;
  try {
    const res = await fetch(`/api/files/browse/version?${qs(pathRel)}`);
    if (!res.ok) return;
    const data = await res.json();
    const onDisk = typeof data.version === "string" ? data.version : null;
    // Still the version we loaded, or the answer arrived after the user moved on.
    if (onDisk === baseVersion.value || pathRel !== openPath.value) return;
    if (dirty.value) conflict.value = { version: onDisk };
    else loadFile(pathRel, true);
  } catch {
    // Offline or the server restarted: the next tick asks again, and the save still can't clobber.
  }
}

function watchExternalChanges(): () => void {
  externalTimer = setInterval(checkForExternalChange, EXTERNAL_CHECK_MS);
  const unsubscribe = usePubSub().subscribe(FILE_WRITE_CHANNEL, (data) => {
    if (isFileWriteEvent(data) && isWriteToOpenFile(data.file, props.cwd, openPath.value)) checkForExternalChange();
  });
  return () => {
    if (externalTimer !== null) clearInterval(externalTimer);
    externalTimer = null;
    unsubscribe();
  };
}

function teardown(): void {
  editor?.destroy();
  editor = null;
  roots.value = [];
  openPath.value = null;
  dirty.value = false;
  baseVersion.value = null;
  conflict.value = null;
  showPreview.value = false;
}

async function start(): Promise<void> {
  await nextTick();
  if (editorHost.value) editor = createEditor(editorHost.value, () => (dirty.value = true));
  await loadRoot();
  await restore(props.initialState ?? null);
  // An explicitly requested path wins over whatever was remembered — it is the more recent
  // intent (a clicked path in terminal output).
  if (props.requestedPath) loadFile(props.requestedPath);
}

/** Put a remembered tree back: open its directories parents-first (each fetches its children),
 *  then the file that was open. Anything since deleted simply isn't found and is skipped. */
async function restore(state: FilesPaneState | null): Promise<void> {
  if (!state) return;
  for (const dirPath of restoreOrder(state.expanded)) {
    const node = findNode(roots.value, dirPath);
    if (node?.dir && !node.expanded) await toggleDir(node);
  }
  if (state.openPath) await loadFile(state.openPath);
}

function findNode(nodes: Node[], target: string): Node | null {
  for (const node of nodes) {
    if (node.path === target) return node;
    const hit = findNode(node.children, target);
    if (hit) return hit;
  }
  return null;
}

// A second clicked path while the pane is already showing: nothing else changes, so
// without this the file would never open.
watch(
  () => props.requestedPath,
  (pathRel) => {
    if (pathRel) loadFile(pathRel);
  },
);

// Closing the tab or reloading is also leaving the file. `keepalive` lets the request outlive
// the page — capped at 64 KB by the browser, so a very large buffer may not make it out, which
// is the one hole autosave can't close.
function onPageHide(): void {
  if (!dirty.value || !openPath.value || !editor) return;
  const pathRel = openPath.value;
  const text = editor.getDoc();
  // Both, unconditionally: there is no awaiting an answer here, so the only way to honour
  // "your version is kept either way" is to bank it whether or not the write wins the race.
  // The cost is one redundant generation per tab-close with unsaved edits.
  bankText(pathRel, text, true);
  writeBuffer(pathRel, text, baseVersion.value, true);
}

let stopWatchingExternal: (() => void) | null = null;
onMounted(() => {
  window.addEventListener("pagehide", onPageHide);
  stopWatchingExternal = watchExternalChanges();
  start();
});
onBeforeUnmount(() => {
  window.removeEventListener("pagehide", onPageHide);
  stopWatchingExternal?.();
  teardown();
});

// `reload` is the host's way to say "the root changed and I have already cleared it with the
// user" — the pane never watches `cwd` itself, because reacting to it would discard a buffer
// the host may still be asking about.
defineExpose({
  /** What this pane looks like right now, for a host that will bring the user back here. */
  snapshot: (): FilesPaneState => ({ openPath: openPath.value, expanded: expandedPaths(roots.value) }),
  reload: async () => {
    teardown();
    await start();
  },
  /** Open a file the host chose — a path clicked in terminal output (#910). Routed through
   *  loadFile, which treats opening another file as leaving this one, so an unsaved buffer is
   *  flushed (or keeps the pane where it is) exactly as it would be from the tree. */
  openFile: (pathRel: string) => loadFile(pathRel),
  flush,
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-auto flex-col" @keydown="onKeydown">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <slot name="title" />
      <span class="flex-auto" />
      <span v-if="openPath" class="min-w-0 truncate font-mono text-[12px]" :class="dirty ? 'text-fg' : 'text-secondary'"
        >{{ openName }}<span v-if="dirty" class="ml-1 text-amber" title="Unsaved">●</span></span
      >
      <button
        v-if="openPath && isMarkdown"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? "Edit" : "Preview" }}
      </button>
      <button
        v-if="openPath"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-accent bg-accent-bg px-2.5 py-1 text-[12px] text-on-accent enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="!dirty || saving"
        @click="save"
      >
        {{ saving ? "Saving…" : "Save" }}
      </button>
      <button
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Reload tree"
        aria-label="Reload tree"
        @click="loadRoot"
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
      <button
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Close"
        aria-label="Close files"
        @click="requestClose"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="flex min-h-0 flex-auto">
      <nav class="basis-[clamp(160px,24%,340px)] shrink-0 grow-0 overflow-auto border-r border-border py-1.5" aria-label="File tree">
        <p v-if="treeError" class="p-4 text-[13px] text-err">{{ treeError }}</p>
        <p v-else-if="roots.length === 0" class="p-4 text-[13px] text-muted">Empty directory.</p>
        <button
          v-for="{ node, depth } in rows"
          :key="node.path"
          type="button"
          data-testid="files-row"
          class="flex w-full cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent px-2 py-[3px] text-left font-mono text-[12px]"
          :class="node.path === openPath ? 'bg-hover text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          @click="openFile(node)"
        >
          <span class="w-3.5 flex-none text-dim">
            <span v-if="node.dir" class="material-symbols-outlined" aria-hidden="true">{{ node.expanded ? "expand_more" : "chevron_right" }}</span>
          </span>
          <span class="material-symbols-outlined flex-none" aria-hidden="true">{{ node.dir ? "folder" : "description" }}</span>
          <span class="truncate">{{ node.name }}</span>
        </button>
      </nav>
      <section class="relative flex min-w-0 flex-auto">
        <div
          v-if="conflict"
          role="alert"
          data-testid="files-conflict"
          class="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-amber bg-[var(--warn-bg-subtle)] px-4 py-2 text-[13px] text-warn"
        >
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <span class="flex-auto">This file changed on disk. Nothing was saved — your version is kept as a backup either way.</span>
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="discardAndReload"
          >
            Reload (discard your edits)
          </button>
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="overwrite"
          >
            Overwrite anyway
          </button>
        </div>
        <p v-if="fileError" class="p-4 text-[13px] text-err">{{ fileError }}</p>
        <p v-if="!openPath" class="m-auto p-4 text-[13px] text-muted">Select a file to view or edit.</p>
        <iframe v-show="openPath && showPreview" class="flex-auto border-0 bg-white" :src="previewSrc" sandbox="" title="Markdown preview" />
        <div v-show="openPath && !showPreview" ref="editorHost" class="files-editor min-w-0 flex-auto overflow-hidden" />
      </section>
    </div>
  </div>
</template>

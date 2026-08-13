<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useDirColors, useDirPriorities } from "../composables/useDirConfig";
import { useResumableSessions, useDirScripts, useDirWorktrees, type ResumableSession, type Worktree } from "../composables/useDirLists";
import { useMcpToolGroups } from "../composables/useMcpToolGroups";
import { orderByDirPriority } from "../../common/dirPriorityOrder";
import { CHIP_IDLE, CHIP_RUNNING, CHIP_DOT_RUNNING } from "./dirChipColor";
import { relativeTime as relativeTimeFrom } from "./cellDisplay";
import { LAUNCH_TARGETS } from "./launchTargets";
import { worktreeAction, worktreeLimitReason } from "../../common/worktreeSession";
import { isSameDirPath } from "../../common/dirPathKey";
import { TOOL_GROUPS, TOOL_GROUP_HEADINGS, toolGroupServerId, toolsInGroup, type ToolGroup } from "../../common/toolGroups";
import type { LaunchAgent } from "../../common/launchAgent";
import type { TerminalAgent } from "../../common/sessionAgent";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import type { LaunchChoice } from "./wsUrl";
import type { RunCommand } from "./runCommand";
import DirPickerModal from "./DirPickerModal.vue";
import LaunchChipList from "./LaunchChipList.vue";
import ModelPicker from "./ModelPicker.vue";

// What an EMPTY grid cell shows: pick a directory, pick what to run in it, and start — or resume
// a session that already exists there, run one of its scripts, or isolate the work in a worktree.
// Mounted only while the cell is empty (TerminalCell renders it under `v-else`), so launching
// unmounts it and closing the session mounts a fresh one.
//
// Three things it decides outlive it and therefore belong to the CELL, arriving here as props:
// the directory field, the launch target, and the model choice.

// Existing sessions, scripts and worktrees are re-read whenever the directory changes; typing is
// debounced so a path is not fetched letter by letter.
const DIR_RELOAD_DEBOUNCE_MS = 300;

const props = defineProps<{
  dir: string;
  target: LaunchAgent;
  choice: LaunchChoice | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  // Configured launch commands (shell/codex/…) offered next to Claude in this launcher.
  launchers?: Launcher[] | undefined;
  // Session ids open in other grid cells. Resuming one of them would detach that cell, so those
  // rows are flagged and refused. The server's own `attached` sees more than this (another tab,
  // another process); this stays because an older server sends no such field.
  openSessionIds?: string[] | undefined;
  // Dirs with a running session in another cell, so a preset chip whose dir is in use is tinted.
  openCwds?: string[] | undefined;
  // An added (not the sole entry) launcher: show a close button to dismiss it before launching.
  cancellable?: boolean | undefined;
}>();

const emit = defineEmits<{
  // `update:dir`: the field's new path. `remove-preset`: the path to drop from the shared list.
  (e: "update:dir" | "remove-preset", value: string): void;
  (e: "update:target", value: LaunchAgent): void;
  (e: "update:choice", value: LaunchChoice | null): void;
  // Start what the selector picked, in this dir. EVERY launch in this form goes through here —
  // the dir field, a preset chip and a worktree alike — so the cell decides once what the picked
  // target means (a shell replaces the cell; an agent runs in it).
  (e: "start", dir: string | null): void;
  // Attach to an existing session, in the cwd its row was listed for. `agent` travels only for a
  // worktree row, whose session may be one the cell's selector is not currently pointed at —
  // resuming a codex conversation as Claude would connect the wrong endpoint to a live id.
  (e: "resume", value: { id: string; cwd: string | null; agent?: TerminalAgent }): void;
  (e: "run", value: RunCommand): void;
  (e: "launch", value: LaunchPick): void;
  (e: "close"): void;
}>();

// An empty field means the server's workspace default — the placeholder is a hint, not a value.
const dirFor = (value: string): string | null => value.trim() || props.defaultCwd;
const targetDir = computed(() => dirFor(props.dir));

// The agent-only parts of the form: a shell takes no model, registers no MCP servers, and is not
// what the worktree row starts.
const launchesAgent = computed(() => props.target !== "shell");

// v-model over a prop the cell owns: typing reports the new path up, and the field shows what
// comes back down.
const dirField = computed({
  get: () => props.dir,
  set: (value: string) => emit("update:dir", value),
});

// Each recent-dir chip wears its directory's configured colour, so picking one is the same visual
// decision as finding its cell in the grid. The subscriptions are dropped when this form unmounts
// (useDirConfig disposes with the scope), which is also the moment the chips leave the screen.
const presetPaths = computed(() => props.presets.map((p) => p.path));
const { colors: presetColors } = useDirColors(presetPaths);
// Chips follow the same rank the grid sorts by, so a project sits in the same place on both
// screens. The stored list stays most-recently-used (recordPreset depends on that) — only the
// display is reordered, which is also what keeps unranked directories where they were.
const { priorities: presetPriorities } = useDirPriorities(presetPaths);
const orderedPresets = computed(() => orderByDirPriority(props.presets, (p) => p.path, presetPriorities.value));

// A preset dir that already has a running session in another cell — the launcher tints its chip
// so the user can tell it's in use before double-launching there.
const runningCwds = computed(() => new Set(props.openCwds ?? []));
const isCwdRunning = (path: string): boolean => runningCwds.value.has(path);

const { value: resumable, load: loadResumable } = useResumableSessions();
const { value: scriptList, load: loadScripts } = useDirScripts();
const { value: worktreeList, load: loadWorktrees } = useDirWorktrees();

// A worktree can be launched into without touching its row: pasted into the field, or reached by a
// preset chip (launching in one records it as a recent directory, so worktree paths DO become
// chips). The one-session rule has to hold on every way in, not just the nearest one.
//
// This is the EXPLANATION, not the guarantee — the server refuses the spawn whatever the client
// believes (session/worktree-session-limit.ts), which is what covers a symlinked path and a chip
// pointing into a repo whose worktree list was never fetched. Here the job is only to grey the
// control out before the click, so the comparison folds the spellings a person types.
//
// The list is the repo's: `git worktree list` reports the main tree first, so it is the same set
// whether the field holds the repo or one of its worktrees.
const worktreeAt = (dir: string | null) => worktreeList.value.worktrees.find((w) => isSameDirPath(w.path, dir))?.session;

// A shell is not an agent session — the limit is on agents editing one working tree, and
// dir-session.ts leaves shells out of the answer for the same reason.
const takenWorktreeAt = (dir: string | null): string | null => {
  const session = launchesAgent.value ? worktreeAt(dir) : null;
  return session ? worktreeLimitReason(session) : null;
};

const startHere = (): void => {
  if (!takenWorktreeAt(targetDir.value)) emit("start", targetDir.value);
};

const {
  dir: mcpGroupDir,
  enabled: mcpGroupEnabled,
  busy: mcpGroupBusy,
  failed: mcpGroupFailed,
  forget: forgetMcpGroups,
  load: loadMcpGroups,
  apply: applyMcpGroup,
  syncInto: syncMcpGroupsInto,
} = useMcpToolGroups();

// Everything this form offers is per-directory, so they are read as one.
function loadForDir(dir: string | null): void {
  void loadResumable(dir);
  void loadScripts(dir);
  void loadWorktrees(dir);
  void loadMcpGroups(dir);
}
onMounted(() => loadForDir(targetDir.value));

// A programmatic dir change (fillDir) loads the lists immediately, so the watch below must skip
// the debounced reload it would otherwise ALSO fire — or every preset click / folder pick would
// fetch the lists twice.
let skipDirWatch = false;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

watch([() => props.dir, () => props.defaultCwd], () => {
  // Cancel any pending debounced reload FIRST — whether we skip (a fillDir just loaded
  // immediately) or reschedule (typing), a stale timer from a prior change (e.g. a type then a
  // preset click) must not fire a duplicate load afterwards.
  if (reloadTimer) clearTimeout(reloadTimer);
  if (skipDirWatch) {
    skipDirWatch = false;
    return;
  }
  // The tool-group switches belong to a directory, and this one just stopped being it. They go as
  // soon as the field changes rather than 300ms later, so a flip cannot land on the directory the
  // user has typed their way off. The reload below puts them back for the new one.
  forgetMcpGroups();
  reloadTimer = setTimeout(() => loadForDir(targetDir.value), DIR_RELOAD_DEBOUNCE_MS);
});
onUnmounted(() => {
  if (reloadTimer) clearTimeout(reloadTimer);
});

// The chip's main click (and the folder picker): fill the field WITHOUT launching, and refresh the
// resume / script / worktree lists for that dir so the user can pick a session to resume — or
// start fresh — instead of launching immediately.
function fillDir(path: string): void {
  // Set the skip only when the value actually changes (so the watch will fire and consume it) — a
  // same-value click doesn't fire the watch and would leave a stale flag that swallows the next
  // real reload.
  if (props.dir !== path) skipDirWatch = true;
  emit("update:dir", path);
  // The prop only comes back down on the next render, so the lists are asked for the picked path
  // rather than for the field's current (still previous) value.
  loadForDir(dirFor(path));
}

// The folder button always opens the in-browser folder picker (DirPickerModal). The native OS
// chooser (POST /api/pick-file) pops up on the SERVER's display, which is unreachable from a
// remote browser — and "remote" cannot be told apart from "local" client-side (an SSH
// port-forward makes a phone look like localhost too), so the native path is never safe to
// prefer. The in-browser picker works the same everywhere. The chosen path fills the
// Working-directory field WITHOUT launching.
const showDirPicker = ref(false);
function pickDir(): void {
  showDirPicker.value = true;
}

// The in-browser picker returned a path: fill the field (no launch) and close the modal.
function onDirPicked(dir: string): void {
  fillDir(dir);
  showDirPicker.value = false;
}

// The chip's launch button: a one-click quick launch — fill the field and jump straight into a
// fresh session in that dir. A chip on a worktree somebody is in fills the field without
// launching, so the reason lands under it rather than nothing happening.
function selectPreset(p: CwdPreset): void {
  if (takenWorktreeAt(p.path)) return fillDir(p.path);
  emit("update:dir", p.path);
  emit("start", p.path);
}

const chipLaunchTitle = (p: CwdPreset): string => {
  const taken = takenWorktreeAt(p.path);
  if (taken) return taken;
  return isCwdRunning(p.path) ? `${p.path} — a session is already running here in another terminal` : `Launch a new terminal in ${p.path} now`;
};

// The same three states as the hover, said with the LABEL rather than the path — the hover can
// afford a full path and a screen reader cannot. It has to carry the refusal too, or the one user
// who cannot see the greyed-out field below is told the click launches a terminal when it does not
// (raised by CodeRabbit on #1208).
const chipLaunchLabel = (p: CwdPreset): string => {
  const taken = takenWorktreeAt(p.path);
  if (taken) return `${p.label} — ${taken}`;
  return isCwdRunning(p.path) ? `${p.label} — a session is already running here in another terminal` : `Launch a new terminal in ${p.label} now`;
};

// Launch a configured program (shell/codex/…) in this cell's chosen dir. The parent turns the
// empty cell into a persistent launcher cell (index is the server allowlist position).
function launchProgram(index: number): void {
  const launcher = props.launchers?.[index];
  if (launcher) emit("launch", { launcher: { index, label: launcher.label }, cwd: targetDir.value });
}

const scriptChips = computed(() => scriptList.value.scripts.map((s) => ({ key: s.index, label: s.label, title: s.command })));
const launcherChips = computed(() => (props.launchers ?? []).map((l) => ({ key: l.label, label: l.label, title: l.command })));

function runScript(index: number): void {
  const script = scriptList.value.scripts[index];
  if (script) emit("run", { source: "script", index: script.index, label: script.label, cwd: scriptList.value.cwd ?? targetDir.value });
}

// A session somebody is holding — a cell in this grid, a second browser tab, a second
// mulmoterminal process. Opening it here would detach whoever has it (the server supersedes the
// prior socket, and a second process ends up fighting over the tmux window size), so the row is
// refused rather than confirmed away.
//
// `attached` is the server's answer and the only one that sees the other two cases; the grid's own
// list still counts, because a server that predates the field says nothing at all (#1207).
const sessionBusy = (s: ResumableSession): boolean => s.attached === true || (props.openSessionIds ?? []).includes(s.id);

function resume(s: ResumableSession): void {
  if (sessionBusy(s)) return;
  // Use the cwd those rows were fetched for, not the (possibly-changed) input.
  emit("resume", { id: s.id, cwd: resumable.value.cwd ?? targetDir.value });
}

const relativeTime = (ms: number): string => relativeTimeFrom(ms, Date.now());

// What the switch actually does, spelled out for the hover: the MCP SERVER ID it registers and
// the tools that id brings with it. The row's visible label can only name the group, and the
// group name alone ("render", "data") does not say which server appears in `claude mcp list`
// nor what the agent gains — that is exactly what a user checking the box wants to know.
// Derived from toolGroups.ts rather than written out, so a tool added to a group shows up here
// without a second edit (the Canvas empty state names them the same way).
const mcpGroupTitle = (group: ToolGroup): string =>
  `Registers the MCP server "${toolGroupServerId(group)}" for this directory — tools: ${toolsInGroup(group).join(", ")}`;

const worktreeTask = ref("");

// Create a fresh worktree for the typed task and start the selected agent in it.
async function createWorktreeAndLaunch(): Promise<void> {
  const repoDir = targetDir.value;
  const task = worktreeTask.value.trim();
  if (!repoDir || !task) return;
  try {
    const res = await fetch("/api/worktrees/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoDir, task }),
    });
    if (!res.ok) return;
    const wt = await res.json();
    if (typeof wt.path === "string") {
      worktreeTask.value = "";
      await syncMcpGroupsInto(wt.path);
      emit("start", wt.path);
    }
  } catch {
    // best-effort — the launcher stays open so the user can retry
  }
}

// One branch, one session: the row continues the worktree's session when it has one and nobody is
// holding it, and starts a fresh one only when it has none. See common/worktreeSession.ts.
const openWorktree = async (w: Worktree): Promise<void> => {
  const action = worktreeAction(w.session);
  if (action === "busy") return;
  await syncMcpGroupsInto(w.path);
  if (action === "resume" && w.session) emit("resume", { id: w.session.id, cwd: w.path, agent: w.session.agent });
  else emit("start", w.path);
};

// The hover, which is where the three-way rule is actually readable — the row itself can only
// afford a word.
const worktreeTitle = (w: Worktree): string => {
  const where = w.branch ?? w.path;
  if (worktreeAction(w.session) === "busy") return `${where} — its session is open in another terminal`;
  return worktreeAction(w.session) === "resume" ? `${where} — resume this worktree's session` : `${where} — start a session here`;
};

// Remove a managed worktree (＋ its branch). A dirty one is confirmed first so work is never
// discarded silently.
async function removeWorktree(w: Worktree): Promise<void> {
  const repoDir = targetDir.value;
  if (w.dirty && !window.confirm(`"${w.task}" has uncommitted changes. Discard and remove it?`)) return;
  try {
    await fetch("/api/worktrees/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoDir, path: w.path, deleteBranch: true, force: w.dirty }),
    });
    void loadWorktrees(targetDir.value);
  } catch {
    // best-effort
  }
}
</script>

<template>
  <div data-testid="cell-launch" class="flex min-h-0 flex-1 flex-col items-center justify-start gap-2 overflow-y-auto p-4">
    <button
      v-if="cancellable"
      type="button"
      data-testid="cell-launch-cancel"
      class="absolute right-1.5 top-1.5 inline-flex h-[26px] w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-[16px] leading-none text-secondary hover:bg-[var(--err-hover-bg)] hover:text-err-text"
      title="Cancel new terminal"
      aria-label="Cancel new terminal"
      @click="emit('close')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
    <div v-if="presets.length" class="flex max-w-[360px] flex-wrap justify-center gap-1.5">
      <span
        v-for="p in orderedPresets"
        :key="p.label + p.path"
        data-testid="cell-chip"
        class="inline-flex items-stretch overflow-hidden rounded-[14px] border"
        :class="[{ 'is-running': isCwdRunning(p.path) }, isCwdRunning(p.path) ? CHIP_RUNNING : CHIP_IDLE]"
      >
        <!-- The directory's colour lives ONLY in this stripe; the chip's background and border
           mean "a session is running here" and nothing else. The two used to share both, at
           identical strengths, so a colour-coded directory read as running (#1106). Wider than
           it was, now that it carries the directory on its own. -->
        <span
          v-if="presetColors[p.path]"
          data-testid="cell-chip-color"
          class="w-[8px] flex-none"
          :style="{ background: presetColors[p.path] }"
          aria-hidden="true"
        />
        <button
          type="button"
          data-testid="cell-chip-main"
          class="cursor-pointer border-none bg-transparent px-2.5 py-1 font-sans text-[12px] hover:bg-hover hover:text-fg"
          :class="isCwdRunning(p.path) ? 'text-fg' : 'text-secondary'"
          :title="isCwdRunning(p.path) ? `${p.path} — a session is already running here` : p.path"
          :aria-label="`Use ${p.label} — fill the field to browse / resume here (without launching)${isCwdRunning(p.path) ? '. A session is already running here.' : ''}`"
          @click="fillDir(p.path)"
        >
          <span
            v-if="isCwdRunning(p.path)"
            data-testid="cell-chip-dot"
            :class="`mr-[5px] inline-block h-1.5 w-1.5 rounded-full align-middle ${CHIP_DOT_RUNNING}`"
            aria-hidden="true"
          />{{ p.label }}
        </button>
        <button
          type="button"
          data-testid="cell-chip-launch"
          class="inline-flex cursor-pointer items-center border-0 border-l border-l-border bg-transparent px-[5px] text-secondary hover:bg-hover hover:text-fg"
          :title="chipLaunchTitle(p)"
          :aria-label="chipLaunchLabel(p)"
          @click="selectPreset(p)"
        >
          <span class="material-symbols-outlined text-[14px]" aria-hidden="true">play_arrow</span>
        </button>
        <button
          type="button"
          data-testid="cell-chip-del"
          class="cursor-pointer border-0 border-l border-l-border bg-transparent px-[7px] text-[11px] text-secondary hover:bg-hover hover:text-[var(--danger,#e5484d)]"
          :title="`Remove ${p.path} from the list`"
          :aria-label="`Remove ${p.path} from the list`"
          @click="emit('remove-preset', p.path)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </span>
    </div>
    <!-- Wraps rather than overflowing: four options do not fit one row in a narrow cell, and
         the one that would fall off the edge is the last, Shell. -->
    <div
      class="inline-flex max-w-[360px] flex-wrap gap-0.5 self-start rounded-[7px] border border-border bg-deep p-0.5"
      role="radiogroup"
      aria-label="What this terminal runs"
    >
      <button
        v-for="t in LAUNCH_TARGETS"
        :key="t.agent"
        type="button"
        :data-testid="`cell-target-${t.agent}`"
        class="cursor-pointer rounded-[5px] border-none px-3.5 py-1 font-sans text-[12px] font-medium"
        :class="target === t.agent ? 'bg-elevated text-fg' : 'bg-transparent text-dim hover:text-fg'"
        role="radio"
        :aria-checked="target === t.agent"
        :title="t.title"
        @click="emit('update:target', t.agent)"
      >
        {{ t.label }}
      </button>
    </div>
    <label class="flex w-full max-w-[360px] flex-col items-center gap-1.5">
      <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">Working directory</span>
      <span class="flex w-full items-stretch gap-1.5">
        <input
          v-model="dirField"
          data-testid="cell-dir-input"
          class="box-border w-full rounded-md border border-border bg-input px-2.5 py-[7px] font-mono text-[12px] text-fg focus:border-accent focus:outline-none min-w-0 flex-auto"
          type="text"
          placeholder="/path/to/project"
          spellcheck="false"
          @keydown.enter="startHere"
        />
        <button
          type="button"
          class="flex-none inline-flex items-center justify-center px-2 rounded-md border border-border bg-elevated text-secondary cursor-pointer hover:bg-hover hover:text-fg hover:border-accent"
          title="Choose a folder…"
          aria-label="Choose the working directory"
          @click="pickDir"
        >
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">folder_open</span>
        </button>
        <button
          type="button"
          data-testid="cell-dir-go"
          class="inline-flex flex-none cursor-pointer items-center justify-center rounded-md border border-border bg-elevated px-2 text-secondary enabled:hover:border-accent enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
          :disabled="!dir.trim() || !!takenWorktreeAt(targetDir)"
          :title="takenWorktreeAt(targetDir) ?? 'Start a new terminal here (or press Enter)'"
          aria-label="Start a new terminal here"
          @click="startHere"
        >
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">play_arrow</span>
        </button>
      </span>
      <!-- The field can be pointed AT a worktree — pasted, or filled by a chip — which is the same
           launch the worktree row refuses. Saying why beats a play button that just does nothing. -->
      <span v-if="takenWorktreeAt(targetDir)" data-testid="cell-dir-busy" class="font-sans text-[11px] leading-snug text-amber">{{
        takenWorktreeAt(targetDir)
      }}</span>
    </label>
    <!-- Codex has its own model configuration and doesn't read this one. Keyed on the SELECTOR,
         not on the agent the cell will run: that reads "claude" while Shell is picked (a shell has
         no agent), and a model picker over a shell would offer a choice nothing acts on. -->
    <ModelPicker v-if="target === 'claude'" :model-value="choice" @update:model-value="(value) => emit('update:choice', value)" />
    <!-- A GUI tool group is a per-DIRECTORY registration in Claude Code's own MCP config, not
         a per-launch choice — but it only takes effect when a session starts, so this is
         where it belongs: decided before the thing it configures exists.
         BOTH agents: claude reads that config itself, and a codex cell is handed the same
         groups as resolved URLs at spawn (server/session/spawn-codex.ts), so one switch
         answers for both. It is still Claude Code's file — writing it needs the `claude`
         CLI on PATH, which is why a failure here says so rather than silently doing nothing.
         One row per group in TOOL_GROUPS, because one switch is one MCP server: render and
         media both draw but differ in what a call costs, and data and external do not draw at
         all — the split is exactly what the grouping exists for (common/toolGroups.ts). -->
    <template v-if="mcpGroupDir && launchesAgent">
      <!-- The hover names the server id and its tools (mcpGroupTitle); it sits on the ROW so
           the text is reachable from the label as well as the box. -->
      <label v-for="group in TOOL_GROUPS" :key="group" class="flex w-full max-w-[360px] items-center justify-between gap-2" :title="mcpGroupTitle(group)">
        <!-- The group is named, not just the feature: each switch registers ONE MCP server
           (`mulmoterminal-<group>`), so a heading alone would not say which of the four rows
           writes which server — and two of them share the heading "Canvas".
           `normal-case` on the suffix — the section labels around it are uppercased by
           class, and "(RENDER MCPS)" reads as a different thing than the server it names. -->
        <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim"
          >{{ TOOL_GROUP_HEADINGS[group] }} <span class="normal-case">({{ group }} MCPs)</span></span
        >
        <span class="flex items-center gap-2">
          <span v-if="mcpGroupBusy[group]" class="font-sans text-[11px] text-dim">saving…</span>
          <span v-else-if="mcpGroupFailed[group]" class="font-sans text-[11px] text-err-text" :title="mcpGroupFailed[group]!">failed</span>
          <input
            v-model="mcpGroupEnabled[group]"
            :data-testid="`cell-mcp-toggle-${group}`"
            type="checkbox"
            class="h-3.5 w-3.5 cursor-pointer accent-accent"
            :disabled="mcpGroupBusy[group]"
            :title="mcpGroupTitle(group)"
            :aria-label="`Register the MCP server ${toolGroupServerId(group)} (${toolsInGroup(group).join(', ')}) for ${mcpGroupDir}`"
            @change="applyMcpGroup(group)"
          />
        </span>
      </label>
    </template>
    <div v-if="worktreeList.isGit && launchesAgent" data-testid="cell-worktrees" class="flex w-full max-w-[360px] flex-col items-stretch gap-1.5">
      <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">or isolate in a worktree (git repo)</span>
      <!-- Said here rather than left to be inferred from a row that behaves differently each time:
           the one-session rule is why a row resumes instead of launching, and why one of them
           cannot be clicked at all. -->
      <span data-testid="wt-note" class="font-sans text-[11px] leading-snug text-dim"
        >A worktree is tied to a branch, so it runs one agent session and is never started twice: a row resumes the session it already has, and a row marked
        <span class="text-amber">in use</span> is open in another terminal.</span
      >
      <div class="flex gap-1.5">
        <input
          v-model="worktreeTask"
          data-testid="wt-task"
          class="box-border w-full rounded-md border border-border bg-input px-2.5 py-[7px] font-mono text-[12px] text-fg focus:border-accent focus:outline-none w-auto min-w-0 flex-auto"
          type="text"
          placeholder="task name (e.g. fix-login)"
          aria-label="Worktree task name"
          spellcheck="false"
          @keydown.enter="createWorktreeAndLaunch"
        />
        <button
          data-testid="wt-start"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-elevated px-4 py-[7px] font-sans text-[14px] font-medium text-secondary flex-none whitespace-nowrap hover:bg-hover hover:text-fg"
          :disabled="!worktreeTask.trim()"
          @click="createWorktreeAndLaunch"
        >
          <span class="material-symbols-outlined" aria-hidden="true">add</span> New worktree
        </button>
      </div>
      <div v-for="w in worktreeList.worktrees" :key="w.path" class="flex items-center gap-1.5">
        <button
          class="flex-auto min-w-0 text-left rounded-md border bg-elevated font-mono text-[12px] py-[5px] px-2.5 truncate"
          :class="
            worktreeAction(w.session) === 'busy'
              ? 'border-amber text-dim cursor-not-allowed'
              : 'border-border text-secondary cursor-pointer hover:bg-hover hover:text-fg'
          "
          data-testid="worktree-reuse"
          :disabled="worktreeAction(w.session) === 'busy'"
          :title="worktreeTitle(w)"
          @click="openWorktree(w)"
        >
          ⎇ {{ w.task }}<span v-if="w.dirty" data-testid="wt-dirty" class="ml-1.5 text-[var(--warn-text,#e0a030)]" title="uncommitted changes">●</span>
          <span v-if="worktreeAction(w.session) === 'busy'" data-testid="wt-busy" class="ml-1.5 font-sans text-[11px] text-amber">in use</span>
          <span v-else-if="worktreeAction(w.session) === 'resume'" data-testid="wt-resume" class="ml-1.5 font-sans text-[11px] text-dim">resume</span>
        </button>
        <button
          data-testid="wt-del"
          class="flex-none cursor-pointer rounded-md border-none bg-transparent px-1.5 py-1 text-[13px] hover:bg-[var(--err-hover-bg)]"
          title="Remove worktree"
          aria-label="Remove worktree"
          @click="removeWorktree(w)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </div>
    </div>
    <LaunchChipList heading="or run a script" icon="play_arrow" :chips="scriptChips" @pick="runScript" />
    <LaunchChipList heading="or launch" icon="rocket_launch" :chips="launcherChips" @pick="launchProgram" />
    <div v-if="resumable.sessions.length" data-testid="cell-resume" class="flex min-h-0 w-full max-w-[360px] flex-col items-center gap-1.5">
      <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">or resume here</span>
      <div class="flex w-full flex-col gap-1">
        <button
          v-for="s in resumable.sessions"
          :key="s.id"
          data-testid="cell-resume-item"
          class="flex items-baseline justify-between gap-2 rounded-md border bg-deep px-2.5 py-[5px] text-left font-sans text-[12px]"
          :class="[
            { 'is-open': sessionBusy(s) },
            sessionBusy(s) ? 'border-amber text-dim cursor-not-allowed' : 'border-border text-secondary cursor-pointer hover:border-accent hover:bg-elevated',
          ]"
          :disabled="sessionBusy(s)"
          :title="sessionBusy(s) ? `${s.title} — open in another terminal, close it there to continue it here` : s.title"
          @click="resume(s)"
        >
          <span data-testid="ri-title" class="truncate">{{ s.title }}</span>
          <!-- A background worker is not the user's own chat, and a FAILED one is the only thing
               here nobody was ever told about: it ran invisibly, ended badly, and pulled no
               attention on the way. Naming it in the list is what makes it findable at all. -->
          <span
            v-if="s.failed"
            data-testid="ri-failed"
            class="flex-none whitespace-nowrap text-[11px] text-err-text"
            title="This background worker ended without finishing a turn"
            >● failed</span
          >
          <span
            v-else-if="s.hidden"
            data-testid="ri-background"
            class="flex-none whitespace-nowrap text-[11px] text-dim"
            title="Ran in the background — not a chat you opened"
            >background</span
          >
          <span v-if="sessionBusy(s)" data-testid="ri-open" class="flex-none whitespace-nowrap text-[11px] text-amber" title="Open in another terminal"
            >● open</span
          >
          <span class="flex-none text-[11px] text-dim">{{ relativeTime(s.mtime) }}</span>
        </button>
      </div>
    </div>
    <DirPickerModal v-if="showDirPicker" :start="targetDir" @select="onDirPicked" @close="showDirPicker = false" />
  </div>
</template>

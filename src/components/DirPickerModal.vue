<script setup lang="ts">
// An in-browser folder / file picker. The native OS dialog (/api/pick-file) opens on the
// SERVER's display, so it's unusable from a remote browser (a phone over Tailscale / an SSH
// forward) — the pickers open this instead. `mode="dir"` chooses the folder currently shown;
// `mode="file"` lists files too and returns the one tapped. Navigates /api/dir-list and emits
// the chosen absolute path.
import { ref, computed, onMounted } from "vue";

const props = withDefaults(defineProps<{ start?: string | null; mode?: "dir" | "file" }>(), { start: null, mode: "dir" });
const emit = defineEmits<{ (e: "select", path: string): void; (e: "close"): void }>();

interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

const path = ref<string>("");
const parent = ref<string | null>(null);
const home = ref<string>("");
const entries = ref<DirEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const title = computed(() => (props.mode === "file" ? "Select file" : "Select folder"));

async function load(dir?: string | null): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams();
    if (dir) params.set("path", dir);
    if (props.mode === "file") params.set("files", "1");
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : "";
    const res = await fetch(`/api/dir-list${suffix}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    path.value = data.path;
    parent.value = data.parent ?? null;
    home.value = data.home ?? "";
    entries.value = Array.isArray(data.entries) ? data.entries : [];
  } catch {
    error.value = "Could not read this folder.";
  } finally {
    loading.value = false;
  }
}

// A directory navigates into it; a file (only present in file mode) is the selection.
function onEntry(e: DirEntry): void {
  if (e.dir) void load(e.path);
  else emit("select", e.path);
}

onMounted(() => load(props.start));
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.55)]" @click.self="emit('close')">
    <div
      class="flex max-h-[85vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-[10px] border border-border bg-base p-4 font-sans text-fg"
      role="dialog"
      :aria-label="title"
    >
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-semibold">{{ title }}</h2>
        <button
          class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
          aria-label="Close"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <!-- Current path + quick jumps -->
      <div class="mt-3 flex items-center gap-2">
        <button
          class="cursor-pointer rounded-md border border-border bg-elevated px-2 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40"
          :disabled="!parent"
          title="Up one level"
          @click="load(parent)"
        >
          ↑
        </button>
        <button
          class="cursor-pointer rounded-md border border-border bg-elevated px-2 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg"
          title="Home"
          @click="load(home)"
        >
          🏠
        </button>
        <div class="min-w-0 flex-auto truncate rounded-md border border-border bg-elevated px-2 py-1 font-mono text-[12px] text-dim" :title="path">
          {{ path || "…" }}
        </div>
      </div>

      <!-- Entry list -->
      <div class="mt-3 min-h-[160px] flex-auto overflow-y-auto rounded-md border border-border bg-elevated">
        <p v-if="loading" class="p-3 text-[12px] text-muted">Loading…</p>
        <p v-else-if="error" class="p-3 text-[12px] text-err-text">{{ error }}</p>
        <p v-else-if="entries.length === 0" class="p-3 text-[12px] text-muted">
          {{ mode === "file" ? "Nothing here." : "No sub-folders here." }}
        </p>
        <ul v-else class="m-0 list-none p-0">
          <li v-for="e in entries" :key="e.path">
            <button
              class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[13px] hover:bg-hover"
              :class="e.dir ? 'text-fg' : 'text-secondary'"
              :data-testid="e.dir ? 'dir-pick-dir' : 'dir-pick-file'"
              @click="onEntry(e)"
            >
              <span class="text-muted">{{ e.dir ? "📁" : "📄" }}</span>
              <span class="min-w-0 truncate">{{ e.name }}</span>
            </button>
          </li>
        </ul>
      </div>

      <!-- Footer: dir mode chooses the folder shown; file mode is a tap on a file above. -->
      <div class="mt-3 flex items-center justify-end gap-2">
        <button
          class="cursor-pointer rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          v-if="mode === 'dir'"
          data-testid="dir-pick-confirm"
          class="cursor-pointer rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] font-semibold text-[var(--accent-fg,#fff)] hover:opacity-90 disabled:cursor-default disabled:opacity-40"
          :disabled="!path"
          @click="emit('select', path)"
        >
          Select this folder
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Read-only preview of what each directory's `.mulmoterminal.json` is actually doing.
//
// Writing one is covered (the mulmoterminal-dirs skill); READING one back was not, so a
// setting that was misspelled or rejected looked exactly like a setting that was never made.
// Each directory expands to the values the app resolved, plus the keys it dropped and the
// keys it doesn't know — which is what tells those two cases apart.
import { computed, ref, watch } from "vue";
import { parseDirConfigDetail, sortDirPathsByName, type DirConfigDetailView } from "./dirConfigDetail";
import { presetLabel } from "./presets";

const props = defineProps<{ paths: string[] }>();

const listed = computed(() => sortDirPathsByName(props.paths));

const details = ref<Record<string, DirConfigDetailView>>({});
const loaded = ref<Set<string>>(new Set());

// One request per directory, on first expand rather than on open: a long history would
// otherwise fire a burst of reads for rows nobody looks at.
async function load(path: string) {
  if (loaded.value.has(path)) return;
  loaded.value = new Set([...loaded.value, path]);
  try {
    const res = await fetch(`/api/dir-config-detail?cwd=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`dir-config-detail ${res.status} for ${path}`);
    details.value = { ...details.value, [path]: parseDirConfigDetail(await res.json()) };
  } catch {
    // Leave the row unloaded so expanding it again retries; the template says nothing is known.
    loaded.value = new Set([...loaded.value].filter((p) => p !== path));
  }
}

// A directory removed from the list (a preset was deleted) must not keep a stale entry around.
watch(
  () => props.paths,
  (paths) => {
    const wanted = new Set(paths);
    details.value = Object.fromEntries(Object.entries(details.value).filter(([path]) => wanted.has(path)));
    loaded.value = new Set([...loaded.value].filter((path) => wanted.has(path)));
  },
);
</script>

<template>
  <p v-if="!paths.length" class="mb-3 mt-1.5 text-[12px] text-dim">No directories yet — open a terminal somewhere and it will be listed here.</p>
  <ul v-else class="m-0 list-none p-0" data-testid="dir-preview-list">
    <li v-for="path in listed" :key="path" class="border-b border-border last:border-b-0">
      <details data-testid="dir-preview-row" @toggle="load(path)">
        <summary class="flex cursor-pointer items-center gap-2 py-2 text-[13px] text-fg">
          <span data-testid="dir-preview-name" class="flex-none font-semibold">{{ presetLabel(path) }}</span>
          <span class="min-w-0 flex-auto truncate text-left font-mono text-[11px] text-dim [direction:rtl]" :title="path"
            ><span class="[unicode-bidi:plaintext]">{{ path }}</span></span
          >
        </summary>

        <div class="pb-3 pl-3 text-[12px]">
          <template v-if="details[path]">
            <p v-if="!details[path].exists" data-testid="dir-preview-gone" class="m-0 text-[var(--warn-text,#e0a030)]">
              This directory no longer exists — the entry is left over from a project that was moved or deleted.
            </p>
            <p v-else-if="!details[path].file" class="m-0 text-dim">No <code>.mulmoterminal.json</code> here — this directory uses the global settings.</p>
            <template v-else>
              <p class="m-0 mb-2 font-mono text-[11px] text-dim">
                {{ details[path].file }}
              </p>
              <p class="m-0 mb-2 text-[11px] text-dim">Everything below comes from that file — no global setting or default is mixed in.</p>

              <table v-if="details[path].rows.length" class="w-full border-collapse" data-testid="dir-preview-values">
                <tbody>
                  <tr v-for="row in details[path].rows" :key="row.key">
                    <td class="py-0.5 pr-3 align-top text-dim">{{ row.label }}</td>
                    <td class="py-0.5 align-top">
                      <span class="inline-flex items-center gap-1.5">
                        <span
                          v-if="row.color"
                          data-testid="dir-preview-swatch"
                          class="inline-block h-3 w-3 flex-none rounded-[3px] border border-border"
                          :style="{ background: row.color }"
                          aria-hidden="true"
                        />
                        <span class="font-mono text-[11px] text-fg">{{ row.value }}</span>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="m-0 text-dim">The file sets nothing this app applies.</p>

              <p v-if="details[path].source.ignored.length" data-testid="dir-preview-ignored" class="m-0 mt-2 text-[var(--warn-text,#e0a030)]">
                Dropped as invalid: <code>{{ details[path].source.ignored.join(", ") }}</code>
              </p>
              <p v-if="details[path].source.unknown.length" data-testid="dir-preview-unknown" class="m-0 mt-1 text-[var(--warn-text,#e0a030)]">
                Not settings this app reads (a typo?): <code>{{ details[path].source.unknown.join(", ") }}</code>
              </p>
            </template>
          </template>
          <p v-else class="m-0 text-dim">Reading…</p>
        </div>
      </details>
    </li>
  </ul>
</template>

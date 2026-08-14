<script setup lang="ts">
import { ref, watch } from "vue";

// The image a directory marks its cells with (`icon` in .mulmoterminal.json, #1421) — the same
// picture in the cell header, the cockpit roster, the filmstrip and the launcher chips, so one
// project reads as one project wherever it appears.
//
// Decorative: the directory's name badge and its path are already beside it in every one of those
// places, so an alt text here would make a screen reader say the project twice.
//
// An animated GIF plays on its own — that is `<img>` doing it, not something this component
// arranges — which is why nothing here decodes or re-encodes the image.
const props = defineProps<{
  src: string | null | undefined;
  // Rendered box in px. Square, and `object-contain`, so a wide logo keeps its aspect ratio
  // instead of the header growing a different height per project.
  size?: number;
}>();

const DEFAULT_SIZE_PX = 14;

// A path that stopped resolving (the file was renamed, a remote host is down) must leave NO
// trace: a broken-image glyph in a cell header reads as a bug in the app rather than as a
// setting pointing at nothing. Reset on a new src so a later, working icon still shows.
const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);
</script>

<template>
  <img
    v-if="src && !failed"
    data-testid="dir-icon"
    class="flex-none rounded-[3px] object-contain"
    :src="src"
    :style="{ width: `${size ?? DEFAULT_SIZE_PX}px`, height: `${size ?? DEFAULT_SIZE_PX}px` }"
    alt=""
    aria-hidden="true"
    draggable="false"
    @error="failed = true"
  />
</template>

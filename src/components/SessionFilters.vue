<script setup lang="ts">
import type { Filter } from "../composables/useSessions";
import FilterChip from "./FilterChip.vue";

// The filter chips + recency re-sort button, shared by the vertical Sidebar and the
// horizontal SessionTabBar. `alignRefreshEnd` pushes the sort button to the far end of
// the row (the vertical sidebar's full-width layout).
//
// Background appears only once there is one to show, so a setup with no collections never
// carries a permanently empty chip — and stays while it is the ACTIVE chip, or the last
// worker finishing would pull the selected filter out from under the user.
defineProps<{
  filter: Filter;
  unreadCount: number;
  backgroundCount: number;
  alignRefreshEnd?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:filter", f: Filter): void;
  (e: "refresh"): void;
}>();
</script>

<template>
  <FilterChip label="All" :active="filter === 'all'" @click="emit('update:filter', 'all')" />
  <FilterChip label="Unread" :count="unreadCount" :active="filter === 'unread'" @click="emit('update:filter', 'unread')" />
  <FilterChip
    v-if="backgroundCount > 0 || filter === 'background'"
    label="Background"
    :count="backgroundCount"
    :active="filter === 'background'"
    @click="emit('update:filter', 'background')"
  />
  <button
    class="cursor-pointer border-0 bg-transparent text-[14px] leading-none text-muted hover:text-fg"
    :class="{ 'ml-auto': alignRefreshEnd }"
    title="Sort by most recent"
    aria-label="Sort by most recent"
    @click="emit('refresh')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
  </button>
</template>

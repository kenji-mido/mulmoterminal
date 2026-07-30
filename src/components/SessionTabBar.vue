<script setup lang="ts">
import { computed } from "vue";
import { SESSION_SPINNER, sessionDotFor, useSessionFilter, type SessionListEmits, type SessionListProps } from "../composables/sessionList";
import SessionFilters from "./SessionFilters.vue";
import { agentBadge } from "../../common/sessionAgent";

// Presentational: list + filter are owned by App.vue and shared with the
// vertical Sidebar, so switching layouts preserves them (no refetch/reset).
const props = defineProps<SessionListProps>();
const emit = defineEmits<SessionListEmits>();

const { unreadCount, backgroundCount, filteredSessions, isUnread } = useSessionFilter(props);

// The horizontal bar never scrolls — tabs flex to share the available width.
// Cap to the most-recent N (sessions are already sorted by recency) so they
// don't shrink to unreadable slivers when there are many. The unread filter
// applies before the cap.
const MAX_TABS = 8;
const visibleSessions = computed(() => filteredSessions.value.slice(0, MAX_TABS));
</script>

<template>
  <div class="flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-panel px-2.5 font-sans text-fg">
    <button
      class="h-[26px] w-[26px] shrink-0 cursor-pointer rounded-md border-0 bg-selected text-[16px] leading-none text-secondary hover:bg-selected-hover"
      title="New session"
      aria-label="New session"
      @click="emit('new')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
    </button>
    <button
      class="h-[26px] w-[26px] shrink-0 cursor-pointer rounded-md border-0 bg-selected text-[12px] font-semibold uppercase leading-none text-secondary hover:bg-selected-hover"
      title="New Codex session"
      aria-label="New Codex session"
      @click="emit('new-codex')"
    >
      cx
    </button>
    <button
      class="h-[26px] w-[26px] shrink-0 cursor-pointer rounded-md border-0 bg-selected text-[12px] font-semibold uppercase leading-none text-secondary hover:bg-selected-hover"
      title="New Antigravity session"
      aria-label="New Antigravity session"
      @click="emit('new-antigravity')"
    >
      ag
    </button>

    <div class="flex shrink-0 items-center gap-1.5">
      <SessionFilters
        :filter="filter"
        :unread-count="unreadCount"
        :background-count="backgroundCount"
        @update:filter="emit('update:filter', $event)"
        @refresh="emit('refresh')"
      />
    </div>

    <div class="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
      <!-- Both branches set a background: there is no Tailwind preflight (src/tailwind.css), so a
           <button> with no bg-* falls back to the UA's ButtonFace — a light grey pill that made
           the idle tabs' text-secondary near-unreadable on every dark theme. It stays in the
           branches rather than the static class so two bg-* utilities never compete on one
           element (see cellChromeClasses.ts). -->
      <button
        v-for="s in visibleSessions"
        :key="s.id"
        class="relative flex h-7 min-w-0 max-w-[200px] flex-1 cursor-pointer items-center gap-[5px] rounded-md border px-2.5 text-[12px] text-secondary transition-[background] duration-[120ms] ease-[ease]"
        :class="s.id === props.activeId ? 'border-accent bg-subtle' : 'border-transparent bg-transparent hover:bg-subtle'"
        :title="s.title"
        :aria-current="s.id === props.activeId ? 'page' : undefined"
        @click="emit('select', s.id, s.agent ?? 'claude')"
      >
        <span
          v-if="s.working && !s.waiting && s.id !== props.activeId"
          :class="[SESSION_SPINNER, 'flex-none']"
          role="img"
          title="Claude is working"
          aria-label="Claude is working"
        />
        <span v-if="agentBadge(s.agent)" class="shrink-0 rounded-[3px] bg-selected px-1 text-[9px] font-bold uppercase text-dim">{{
          agentBadge(s.agent)?.short
        }}</span>
        <span class="truncate" :class="{ 'font-bold text-fg': isUnread(s) }">{{ s.title }}</span>
        <!-- One dot, two meanings until #1139: `--err-strong` red marked both a row stopped on a
             permission prompt and one that had merely finished — and a finished turn is not an
             error. The hue now comes from the same rule the grid and the roster read. -->
        <span
          v-if="s.id !== props.activeId && sessionDotFor(s)"
          data-testid="tab-dot"
          :class="[sessionDotFor(s)?.cls, 'shadow-[0_0_0_2px_var(--bg-panel)]']"
          role="img"
          :title="sessionDotFor(s)?.label"
          :aria-label="sessionDotFor(s)?.label"
        />
      </button>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <button
        class="bg-transparent border-0 text-muted text-base leading-none cursor-pointer hover:text-fg"
        title="Switch to vertical sidebar"
        aria-label="Switch to vertical sidebar"
        @click="emit('toggle-layout')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">dock_to_right</span>
      </button>
    </div>
  </div>
</template>

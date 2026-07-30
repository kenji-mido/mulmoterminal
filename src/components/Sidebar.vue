<script setup lang="ts">
import {
  SESSION_SPINNER,
  sessionDotFor,
  sessionListEmptyMessage,
  useSessionFilter,
  type SessionListEmits,
  type SessionListProps,
} from "../composables/sessionList";
import SessionFilters from "./SessionFilters.vue";
import { relativeTime } from "./cellDisplay";
import { agentBadge } from "../../common/sessionAgent";

// Presentational: the session list + filter are owned by App.vue (a single
// useSessions instance shared across layouts) so toggling vertical/horizontal
// doesn't reset or refetch them.
const props = defineProps<
  SessionListProps & {
    // Only the vertical layout has room to report these; the tab bar just shows what it has.
    loading: boolean;
    error: string | null;
  }
>();
const emit = defineEmits<SessionListEmits>();

const { unreadCount, backgroundCount, filteredSessions, isUnread } = useSessionFilter(props);
</script>

<template>
  <aside class="flex w-[260px] shrink-0 flex-col overflow-hidden border-r border-border bg-panel font-sans text-fg">
    <div class="flex h-10 flex-none items-center justify-between border-b border-border px-3.5">
      <span class="text-[13px] font-semibold tracking-[0.05em] text-muted">Sessions</span>
      <button
        class="bg-transparent border-0 text-muted text-base leading-none cursor-pointer hover:text-fg"
        title="Switch to horizontal tabs"
        aria-label="Switch to horizontal tabs"
        @click="emit('toggle-layout')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">toolbar</span>
      </button>
    </div>

    <div class="mx-3 mb-2 flex gap-2">
      <button
        class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-selected p-2 text-[13px] text-secondary hover:bg-selected-hover"
        @click="emit('new')"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">add</span> New session
      </button>
      <button
        class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-selected p-2 text-[13px] text-secondary hover:bg-selected-hover"
        title="New Codex session"
        @click="emit('new-codex')"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">add</span> Codex
      </button>
      <button
        class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-selected p-2 text-[13px] text-secondary hover:bg-selected-hover"
        title="New Antigravity session"
        @click="emit('new-antigravity')"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">add</span> AGY
      </button>
    </div>

    <div class="flex items-center gap-1.5 px-3 pb-2">
      <SessionFilters
        :filter="filter"
        :unread-count="unreadCount"
        :background-count="backgroundCount"
        align-refresh-end
        @update:filter="emit('update:filter', $event)"
        @refresh="emit('refresh')"
      />
    </div>

    <div v-if="loading" class="px-3.5 py-3 text-[13px] text-muted">Loading…</div>
    <div v-else-if="error" class="px-3.5 py-3 text-[13px] text-err">
      {{ error }}
    </div>
    <div v-else-if="sessions.length === 0" class="px-3.5 py-3 text-[13px] text-muted">No sessions yet</div>
    <div v-else-if="filteredSessions.length === 0" class="px-3.5 py-3 text-[13px] text-muted">{{ sessionListEmptyMessage(filter) }}</div>

    <ul v-else class="m-0 flex-1 list-none overflow-y-auto p-0">
      <li
        v-for="s in filteredSessions"
        :key="s.id"
        data-testid="session-item"
        class="group relative flex cursor-pointer flex-col gap-0.5 border-l-[3px] px-3.5 py-2.5"
        :class="[{ waiting: isUnread(s) }, s.id === props.activeId ? 'border-l-accent bg-subtle' : 'border-l-transparent hover:bg-subtle']"
        :title="s.title"
        @click="emit('select', s.id, s.agent ?? 'claude')"
      >
        <!-- Row actions, shown on hover and always on a touch device (no hover). ✕ removes from
             the list (keeps the transcript — resumable); 🗑 deletes it permanently (the parent
             confirms first). -->
        <div class="absolute right-1 top-1.5 hidden items-center gap-0.5 group-hover:flex [@media(pointer:coarse)]:flex">
          <button
            type="button"
            data-testid="session-delete"
            class="flex h-6 w-6 items-center justify-center rounded border-none bg-transparent text-[14px] leading-none text-dim hover:bg-hover hover:text-err-text"
            title="Delete permanently"
            aria-label="Delete session permanently"
            @click.stop="emit('delete', s.id)"
          >
            🗑
          </button>
          <button
            type="button"
            data-testid="session-hide"
            class="flex h-6 w-6 items-center justify-center rounded border-none bg-transparent text-[16px] leading-none text-dim hover:bg-hover hover:text-err-text"
            title="Remove from list"
            aria-label="Remove session from list"
            @click.stop="emit('hide', s.id)"
          >
            ✕
          </button>
        </div>
        <span class="truncate pr-12 text-[13px]" :class="{ 'font-bold text-fg': isUnread(s) }">
          <span
            v-if="s.working && !s.waiting && s.id !== props.activeId"
            data-testid="session-spinner"
            :class="[SESSION_SPINNER, 'mr-[5px] inline-block align-middle']"
            role="img"
            title="Claude is working"
            aria-label="Claude is working"
          />
          <!-- Same slot as the spinner, and no row wants both: `working` excludes `waiting`. Bold
               already says "wants you"; the hue says which KIND — stopped on a prompt (amber) or
               finished and unread (green), which used to look identical here (#1139). -->
          <span
            v-else-if="sessionDotFor(s)"
            data-testid="session-dot"
            :class="[sessionDotFor(s)?.cls, 'mr-[5px] inline-block align-middle']"
            role="img"
            :title="sessionDotFor(s)?.label"
            :aria-label="sessionDotFor(s)?.label"
          />
          <span
            v-if="agentBadge(s.agent)"
            data-testid="agent-badge"
            class="mr-[5px] inline-block rounded-[4px] bg-selected px-[5px] align-middle text-[10px] font-semibold uppercase text-dim"
            >{{ agentBadge(s.agent)?.full }}</span
          >
          {{ s.title }}
        </span>
        <span class="text-[11px] text-dim">{{ relativeTime(s.mtime, Date.now()) }}</span>
      </li>
    </ul>
  </aside>
</template>

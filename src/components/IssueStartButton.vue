<script setup lang="ts">
// The "work on this issue" control on a `/prs` issue row (#1173). One click when the repo's clone
// is settled; a menu when several clones could host the work and none has been chosen yet; a
// disabled button that says why when the repo has no clone here at all.
import { computed, useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import { useIssueStart } from "../composables/useIssueStart";
import { issueStartBlockedReason } from "../composables/issueStartPlan";
import { useAppConfig } from "../composables/useAppConfig";
import { formatCwd } from "./cwdDisplay";

const props = defineProps<{ repo: string; issue: number }>();

const { planFor, startIssueWork, rememberClone, isStarting } = useIssueStart();
const { home, saveRepoDir } = useAppConfig();

const plan = computed(() => planFor(props.repo));
const blocked = computed(() => issueStartBlockedReason(plan.value, props.repo));
const busy = computed(() => isStarting(props.repo, props.issue));

const wrap = useTemplateRef<HTMLElement>("wrap");
const { open, toggle, close } = useDropdownMenu(wrap);

function onClick() {
  const current = plan.value;
  if (current.kind === "ready") void startIssueWork(props.repo, props.issue, current.dir);
  else if (current.kind === "choose") toggle();
}

// Picking a clone RECORDS it before starting, so the next issue in this repo is one click — in
// this session as well as after a reload, which is what `rememberClone` is for. The start does not
// wait on the write: a failed save costs the user one more pick later, while blocking the launch on
// it would cost them the launch.
async function pick(dir: string) {
  close();
  void saveRepoDir(rememberClone(props.repo, dir), dir);
  await startIssueWork(props.repo, props.issue, dir);
}

const label = computed(() => (plan.value.kind === "choose" ? "Work on this issue — choose a clone" : `Work on this issue`));
</script>

<template>
  <span ref="wrap" class="relative flex-none">
    <button
      type="button"
      data-testid="issue-start"
      class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border bg-base px-1.5 text-[11px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
      :disabled="!!blocked || busy"
      :title="blocked ?? label"
      :aria-label="blocked ?? label"
      @click.stop.prevent="onClick"
    >
      <span class="material-symbols-outlined text-[14px]" aria-hidden="true">{{ busy ? "hourglass_top" : "play_arrow" }}</span>
      <span v-if="plan.kind === 'choose'" class="material-symbols-outlined text-[14px]" aria-hidden="true">expand_more</span>
    </button>
    <div
      v-if="open && plan.kind === 'choose'"
      data-testid="issue-start-menu"
      class="absolute right-0 z-10 mt-1 w-max min-w-[220px] rounded-md border border-border bg-elevated py-1 shadow-lg"
    >
      <p class="px-2.5 py-1 text-[11px] text-dim">Which clone should this work happen in?</p>
      <button
        v-for="d in plan.dirs"
        :key="d.path"
        type="button"
        data-testid="issue-start-clone"
        class="block w-full cursor-pointer whitespace-nowrap border-none bg-transparent px-2.5 py-1 text-left text-[12px] text-secondary hover:bg-hover hover:text-fg"
        :title="d.path"
        @click.stop.prevent="pick(d.path)"
      >
        {{ d.label }}
        <span class="text-dim">{{ formatCwd(d.path, home, 28) }}</span>
      </button>
    </div>
  </span>
</template>

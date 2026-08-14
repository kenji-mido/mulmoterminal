<script setup lang="ts">
// One repository's open issues — the sibling of GithubPrRepo, extracted for the same reason: the
// lead block and the list below the rule render the same rows.
import type { RepoIssues } from "../../common/ghItems";
import { relativeTimeFromIso } from "./cellDisplay";
import IssueStartButton from "./IssueStartButton.vue";

// `hideHeading`, not `heading` — Vue casts an absent boolean prop to `false`, so the default
// has to be the "show" case. See GithubPrRepo.vue.
defineProps<{ repo: RepoIssues; hideHeading?: boolean }>();
</script>

<template>
  <section class="mb-5">
    <h3 v-if="!hideHeading" class="my-1.5 flex items-center gap-2 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">
      {{ repo.repo }}
      <span v-if="repo.issues" class="text-[11px] font-normal text-muted">{{ repo.issues.length }}</span>
    </h3>
    <p v-if="repo.error" class="px-1 py-6 text-[13px] text-err">{{ repo.error }}</p>
    <p v-else-if="repo.issues && repo.issues.length === 0" class="px-1 py-2 text-[13px] text-muted">No open issues</p>
    <ul v-else-if="repo.issues" class="m-0 list-none p-0">
      <!-- The row is a link to GitHub and the control STARTS work here, so they cannot be one
           element: the button sits beside the anchor rather than inside it. -->
      <li v-for="iss in repo.issues" :key="iss.number" class="flex items-center gap-1.5 rounded-md pr-2 hover:bg-hover">
        <a
          data-testid="prs-row"
          class="flex min-w-0 flex-auto cursor-pointer items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] text-secondary no-underline hover:text-fg"
          :href="iss.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="flex-none font-[ui-monospace,monospace] text-dim">#{{ iss.number }}</span>
          <span class="min-w-0 flex-auto truncate">{{ iss.title }}</span>
          <span class="flex-none text-[11px] text-dim">{{ iss.author }} · {{ relativeTimeFromIso(iss.updatedAt, Date.now()) }}</span>
        </a>
        <IssueStartButton :repo="repo.repo" :issue="iss.number" />
      </li>
    </ul>
    <p v-if="repo.truncated" class="px-1 py-2 text-[13px] text-muted">
      Showing the latest {{ repo.issues?.length ?? 0 }} —
      <a :href="repo.url" target="_blank" rel="noopener noreferrer" data-testid="prs-link" class="text-accent underline">see all open issues on GitHub</a>.
    </p>
  </section>
</template>

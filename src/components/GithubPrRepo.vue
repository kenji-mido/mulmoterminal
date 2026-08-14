<script setup lang="ts">
// One repository's open pull requests. Extracted from GithubPane so the SAME rows serve both
// places the pane now renders them: the lead block (the cell's own repo, paired with its issues)
// and the list of everything else below the rule. Two copies would be one jscpd finding and two
// things to keep in step.
//
// `heading` is the repo name by default and suppressed in the lead block, where the repo is
// already named once above both halves.
import type { CiState, RepoPrs } from "../../common/ghItems";
import { relativeTimeFromIso } from "./cellDisplay";

// `hideHeading` rather than `heading`, because Vue casts an ABSENT boolean prop to `false`
// rather than leaving it undefined — so a `heading` defaulting to "show" could not be
// expressed without a withDefaults wrapper, and the first cut silently rendered no repo name
// anywhere. Phrased as the exception, the default falls out right.
defineProps<{ repo: RepoPrs; hideHeading?: boolean }>();

const CI_TITLE: Record<CiState, string> = { passing: "Checks passing", failing: "Checks failing", pending: "Checks running", none: "No checks" };
const REVIEW_LABEL: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

// CI dot colour: passing green (hardcoded, token-less), failing/pending on the
// theme err/amber tokens, no-checks the dim default.
function ciDotClass(ci: CiState): string {
  if (ci === "passing") return "bg-[#3fae6b]";
  if (ci === "failing") return "bg-err-text";
  if (ci === "pending") return "bg-amber";
  return "bg-dim";
}
// Review-tag colour: approved green, changes-requested red; anything else keeps
// the neutral tag colours. Returns text + border together so there's no cascade race.
function reviewTagClass(review: string): string {
  if (review === "APPROVED") return "border-[#3fae6b] text-[#3fae6b]";
  if (review === "CHANGES_REQUESTED") return "border-err-text text-err-text";
  return "border-border text-muted";
}
</script>

<template>
  <section class="mb-5">
    <h3 v-if="!hideHeading" class="my-1.5 flex items-center gap-2 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">
      {{ repo.repo }}
      <span v-if="repo.prs" class="text-[11px] font-normal text-muted">{{ repo.prs.length }}</span>
    </h3>
    <p v-if="repo.error" class="px-1 py-6 text-[13px] text-err">{{ repo.error }}</p>
    <p v-else-if="repo.prs && repo.prs.length === 0" class="px-1 py-2 text-[13px] text-muted">No open PRs</p>
    <ul v-else-if="repo.prs" class="m-0 list-none p-0">
      <li v-for="pr in repo.prs" :key="pr.number">
        <a
          data-testid="prs-row"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] text-secondary no-underline hover:bg-hover hover:text-fg"
          :href="pr.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="h-[9px] w-[9px] flex-none rounded-full" :class="ciDotClass(pr.ci)" role="img" :aria-label="CI_TITLE[pr.ci]" :title="CI_TITLE[pr.ci]" />
          <span class="flex-none font-[ui-monospace,monospace] text-dim">#{{ pr.number }}</span>
          <span class="min-w-0 flex-auto truncate">{{ pr.title }}</span>
          <span v-if="pr.isDraft" class="flex-none rounded-[10px] border border-border px-1.5 py-px text-[11px] text-dim">draft</span>
          <span v-if="pr.review" class="flex-none rounded-[10px] border px-1.5 py-px text-[11px]" :class="reviewTagClass(pr.review)">{{
            REVIEW_LABEL[pr.review] ?? pr.review.toLowerCase()
          }}</span>
          <span class="flex-none text-[11px] text-dim">{{ pr.author }} · {{ relativeTimeFromIso(pr.updatedAt, Date.now()) }}</span>
        </a>
      </li>
    </ul>
    <p v-if="repo.truncated" class="px-1 py-2 text-[13px] text-muted">Showing the first {{ repo.prs?.length ?? 0 }} — this repo has more open PRs.</p>
  </section>
</template>

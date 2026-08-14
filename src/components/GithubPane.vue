<script setup lang="ts">
// The cross-repo PR + issue list itself — the whole GitHub view except where it is mounted.
// Two hosts render it: GithubOverlay (full screen, route-driven) and TerminalGrid (the right-hand
// pane beside a zoomed cell), the same split FilesPane / FilesOverlay already use.
//
// Fetches /api/prs and /api/issues (the repos set in Settings, aggregated server-side via `gh`)
// when it mounts and on the reload button, grouped by repo. Read-only apart from IssueStartButton:
// a row click opens it on GitHub.
//
// `cwd` is the directory of the cell this was opened beside, and all it does is decide which
// repo's section leads (common/githubPaneOrder.ts). A directory that names no repository is an
// ordinary case — the list renders in the configured order.
import { computed, ref, onMounted } from "vue";
import type { RepoIssues, RepoPrs } from "../../common/ghItems";
import { leadWithRepo, repoForCwd } from "../../common/githubPaneOrder";
import { useIssueStart } from "../composables/useIssueStart";
import GithubPrRepo from "./GithubPrRepo.vue";
import GithubIssueRepo from "./GithubIssueRepo.vue";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

// `expanded` is the grid's paneFull: the pane may be widened over the terminal, and it MUST come
// with the control to undo that — `paneFull` covers every pane except files, so without the button
// a cell that remembered this pane could open full-width with no route back to the split.
//
// `canExpand` is which HOST is rendering. Only the grid has a terminal to expand over; the overlay
// is already the whole screen, and it showed the button as a visible no-op because it listens for
// no `toggleExpand` (both Codex review). It cannot be inferred from `expanded` — Vue casts an
// absent boolean prop to `false`, so "not expanded" and "cannot expand" arrive identical.
const props = defineProps<{ cwd?: string | null; expanded?: boolean; canExpand?: boolean }>();
const emit = defineEmits<{ (e: "close" | "toggleExpand"): void }>();

const { loadRepoDirs, startError, repoDirs } = useIssueStart();

const repos = ref<RepoPrs[]>([]);
const issueRepos = ref<RepoIssues[]>([]);

// Resolved from the reverse map /api/repo-dirs already serves (loadRepoDirs below fetches it for
// the issue rows' start control either way), so leading with the cell's repo costs no request and
// no `git` subprocess of its own.
const leadRepo = computed(() => repoForCwd(props.cwd, repoDirs.value));

// The cell's own repo is pulled OUT of both lists and shown as a pair at the top — its PRs and its
// issues together, under one heading — with everything else below a rule in the familiar
// two-section form. Leading with it inside the existing sections was the first cut; the pair reads
// better because the question at a cell is "what is open on THIS repo", and that answer was split
// across two places the user had to scroll between.
const sameRepo = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();
const leadPrs = computed(() => repos.value.find((r) => sameRepo(r.repo, leadRepo.value)) ?? null);
const leadIssues = computed(() => issueRepos.value.find((r) => sameRepo(r.repo, leadRepo.value)) ?? null);
const hasLead = computed(() => leadPrs.value !== null || leadIssues.value !== null);

// `leadWithRepo` still orders the remainder: with the lead extracted it is a no-op, but it stays
// the single answer to "what order do these come in" for the host that passes no cwd at all.
const otherPrs = computed(() =>
  leadWithRepo(
    repos.value.filter((r) => !sameRepo(r.repo, leadRepo.value)),
    leadRepo.value,
  ),
);
const otherIssues = computed(() =>
  leadWithRepo(
    issueRepos.value.filter((r) => !sameRepo(r.repo, leadRepo.value)),
    leadRepo.value,
  ),
);
const loading = ref(false);
const prsError = ref<string | null>(null);
const issuesError = ref<string | null>(null);
let reqId = 0;

// Each section loads independently so one endpoint failing (e.g. a transient
// /api/issues error) never blanks the other — the PR dashboard keeps rendering.
// The two row shapes as they arrive from /api/prs and /api/issues. Only `repo` is required to
// place a row; everything else the templates read is optional there too.
const isRepoPrs = (row: unknown): row is RepoPrs => isRecord(row) && typeof row.repo === "string";
const isRepoIssues = (row: unknown): row is RepoIssues => isRecord(row) && typeof row.repo === "string";

async function loadSection(path: string): Promise<{ rows: unknown[]; error: string | null }> {
  try {
    const res = await fetchWithTimeout(path, undefined, SLOW_COMMAND_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await jsonBody(res);
    return { rows: isUnknownArray(data.repos) ? data.repos : [], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function load(): Promise<void> {
  const id = ++reqId;
  loading.value = true;
  prsError.value = null;
  issuesError.value = null;
  // Alongside the two lists: the issue rows need to know which repos have a clone here before
  // their start control can say anything, and it is the same one-shot read on view open.
  const [prs, issues] = await Promise.all([loadSection("/api/prs"), loadSection("/api/issues"), loadRepoDirs()]);
  if (id !== reqId) return;
  repos.value = prs.rows.filter(isRepoPrs);
  prsError.value = prs.error;
  issueRepos.value = issues.rows.filter(isRepoIssues);
  issuesError.value = issues.error;
  loading.value = false;
}

// On mount rather than on a route change: each host mounts this fresh when it opens (the overlay
// with `v-if`, the grid pane when `rightPane` becomes "github"), so mounting IS being entered —
// and open PRs change as work lands elsewhere, so a stale list is worth one fetch.
onMounted(() => void load());
</script>

<template>
  <!-- `h-full` and `min-w-0` are load-bearing, and neither was needed while this was a
       full-screen `fixed` overlay. As a flex item its default `min-width: auto` refuses to go
       narrower than its content, and a PR title is long — so the pane grew past the width the
       grid gave it and squeezed the terminal beside it to nothing. `truncate` on the rows only
       works with an unbroken min-w-0 chain above it, which is why the scroller carries it too. -->
  <div class="flex h-full min-h-0 min-w-0 flex-col bg-deep" role="region" aria-label="GitHub pull requests and issues">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <!-- Each host writes its own title: the overlay names the view, the grid pane says which
           cell's repo it is leading with. -->
      <slot name="title"><span class="text-[14px] font-[650] text-fg">GitHub</span></slot>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="loading"
        title="Reload"
        aria-label="Reload PR and issue list"
        @click="load"
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
      <span v-if="loading" class="text-[12px] text-muted">Loading…</span>
      <!-- Expand then close, in that order, exactly as the Canvas and Tools headers have them: the
           panes share one slot, so the same control must be in the same place in each. -->
      <div class="ml-auto flex items-center gap-1">
        <button
          v-if="canExpand"
          type="button"
          data-testid="github-expand-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :title="expanded ? 'Restore the terminal beside GitHub' : 'Expand GitHub over the terminal'"
          :aria-label="expanded ? 'Restore GitHub pane width' : 'Expand GitHub pane'"
          :aria-pressed="expanded === true"
          @click="emit('toggleExpand')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
        </button>
        <button
          type="button"
          class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary hover:bg-hover hover:text-fg"
          title="Close"
          aria-label="Close GitHub pane"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </header>
    <div class="min-w-0 flex-auto overflow-y-auto px-4 pb-16 pt-3">
      <p v-if="!loading && !prsError && !issuesError && repos.length === 0 && issueRepos.length === 0" class="px-1 py-6 text-[13px] text-muted">
        No repositories configured. Add <code>owner/repo</code> entries under Settings → Pull request repos.
      </p>
      <template v-else>
        <!-- The cell's own repo, both halves under one heading. Rendered only when it HAS a
             section: a cell whose directory names no repository, or one whose repo is not among
             the configured ones, falls straight through to the list below — the decision that a
             cell like that still opens a useful pane. -->
        <section v-if="hasLead" data-testid="github-lead" class="mb-4">
          <h2 class="mb-2 mt-1 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">{{ leadRepo }}</h2>
          <template v-if="leadPrs">
            <h3 class="mb-1 mt-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Pull requests</h3>
            <GithubPrRepo :repo="leadPrs" hide-heading />
          </template>
          <template v-if="leadIssues">
            <h3 class="mb-1 mt-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Issues</h3>
            <p v-if="startError" data-testid="issue-start-error" class="px-1 py-2 text-[13px] text-err">{{ startError }}</p>
            <GithubIssueRepo :repo="leadIssues" hide-heading />
          </template>
        </section>
        <hr v-if="hasLead && (otherPrs.length > 0 || otherIssues.length > 0)" class="mb-4 border-0 border-t-2 border-border" />

        <h2
          v-if="otherPrs.length > 0 || prsError"
          class="mb-3 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted [&:not(:first-child)]:mt-7 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4"
        >
          Pull requests
        </h2>
        <p v-if="prsError" class="px-1 py-6 text-[13px] text-err">{{ prsError }}</p>
        <GithubPrRepo v-for="r in otherPrs" :key="`pr-${r.repo}`" :repo="r" />

        <h2
          v-if="otherIssues.length > 0 || issuesError"
          class="mb-3 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted [&:not(:first-child)]:mt-7 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4"
        >
          Issues
        </h2>
        <p v-if="issuesError" class="px-1 py-6 text-[13px] text-err">{{ issuesError }}</p>
        <!-- One place for the whole section: only one start can be in flight at a time, so a
             per-repo copy would be the same message repeated down the page. It rides with the lead
             block instead when that is where the button was pressed. -->
        <p v-if="startError && !hasLead" data-testid="issue-start-error" class="px-1 py-2 text-[13px] text-err">{{ startError }}</p>
        <GithubIssueRepo v-for="r in otherIssues" :key="`iss-${r.repo}`" :repo="r" />
      </template>
    </div>
  </div>
</template>

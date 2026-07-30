<script setup lang="ts">
// The one rendered-markdown surface in the wiki browser. Both the page body and the lint
// report go through here so a `[[wiki link]]` looks and behaves the same wherever it is
// printed — MulmoClaude renders both through a single WikiPageBody for the same reason
// (../mulmoclaude/src/plugins/wiki/View.vue). Keeping them as two containers is what let
// their heading rhythm drift apart in the first place (#1125).
import { computed } from "vue";
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import { wikiGotoPage } from "../composables/useWikiBrowse";
import { renderWikiHtml } from "../wikiMarkdown";
import { resolveWikiClickTarget } from "./wikiClickTarget";

// Markdown in, not HTML: the v-html below is only ever fed renderWikiHtml's sanitized
// output because no caller gets to hand it a string of its own.
const props = defineProps<{ markdown: string; graph: WikiGraph | null }>();

const html = computed(() => renderWikiHtml(props.markdown));

// Title→slug map keyed by the EXACT graph title: core's resolveLinkTarget looks up
// `slugByTitle.get(target.trim())` with the raw (non-lowercased) target after slug
// matching, so the keys must match the server graph's titles verbatim — otherwise a
// mixed-case title whose slug differs from its slugified form (e.g. "Foo Bar" →
// meeting-notes-2026) would fail to resolve on click.
const fileSlugs = computed(() => new Set((props.graph?.nodes ?? []).map((n) => n.slug)));
const slugByTitle = computed(() => new Map((props.graph?.nodes ?? []).map((n) => [n.title, n.slug])));

// Read the clicked span's raw target from the DOM, resolve it to a slug, and navigate.
function activateLink(el: HTMLElement | null): void {
  const target = el?.getAttribute("data-page");
  if (!target) return;
  const slug = resolveWikiClickTarget(target, { graph: props.graph, fileSlugs: fileSlugs.value, slugByTitle: slugByTitle.value });
  if (slug) wikiGotoPage(slug);
}

// Mouse + keyboard activation, both event-delegated over the rendered body. The spans
// carry role="link" + tabindex="0" (added in renderWikiHtml) so they're focusable.
function onBodyClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".wiki-link");
  if (!el) return;
  e.preventDefault();
  activateLink(el);
}
function onBodyKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".wiki-link");
  if (!el) return;
  e.preventDefault();
  activateLink(el);
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- LLM-authored, sanitized in renderWikiHtml above -->
  <div class="wiki-body text-[14px] leading-[1.65]" @click="onBodyClick" @keydown="onBodyKeydown" v-html="html"></div>
</template>

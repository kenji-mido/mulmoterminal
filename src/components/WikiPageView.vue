<script setup lang="ts">
// Read-only render of one wiki page: sanitized markdown body with clickable
// `[[wiki links]]`, rewritten image refs, and a "Linked references" (backlinks)
// section derived from the shared graph. Navigation is delegated up via the
// useWikiBrowse helpers — clicking a link/backlink pushes /wiki/pages/<slug>.
import { computed } from "vue";
import { incomingLinks, type WikiGraph } from "@mulmoclaude/core/wiki";
import { wikiGotoPage } from "../composables/useWikiBrowse";
import WikiProse from "./WikiProse.vue";
import type { WikiPage } from "../wikiApi";

const props = defineProps<{ slug: string; page: WikiPage; graph: WikiGraph | null }>();

const backlinks = computed(() => (props.graph ? incomingLinks(props.graph, props.slug) : []));
</script>

<template>
  <article class="mx-auto max-w-[820px] px-7 pt-6 pb-16 text-fg">
    <template v-if="page.exists">
      <h1 class="mb-4 text-[24px] font-bold">{{ page.resolvedTitle }}</h1>
      <WikiProse :markdown="page.content" :graph="graph" />
      <section v-if="backlinks.length" class="mt-10 border-t border-border pt-4">
        <h2 class="mb-2 text-[13px] uppercase tracking-[0.04em] text-muted">Linked references</h2>
        <ul class="m-0 list-none p-0">
          <li v-for="node in backlinks" :key="node.slug">
            <button
              type="button"
              class="cursor-pointer border-0 bg-transparent px-0 py-0.5 text-[14px] text-accent hover:underline"
              @click="wikiGotoPage(node.slug)"
            >
              {{ node.title }}
            </button>
          </li>
        </ul>
      </section>
    </template>
    <p v-else class="px-7 py-12 text-center text-muted">Page “{{ slug }}” not found.</p>
  </article>
</template>

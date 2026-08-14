<script setup lang="ts">
import type { TerminalAgent } from "../../common/sessionAgent";
// The agents' marks, drawn rather than picked: Material Symbols is an icon set, not a brand
// set, so anything from it (`code`, `auto_awesome`) says "generic AI thing" twice and leaves the
// reader to work out which row is which. These are the shapes each tool is actually known by.
//
// Geometry only — no text, no logotype — and both inherit `currentColor`, so a window past its
// warning threshold turns its mark amber along with its number rather than staying a fixed swatch
// beside coloured text.
defineProps<{ agent: TerminalAgent }>();

// Anthropic's burst: spokes around a centre. Drawn from one radius so the arms stay even at the
// 13px this renders at, where a hand-placed path goes lopsided.
const SPOKES = 8;
const spokeRotations = Array.from({ length: SPOKES }, (_, i) => (i * 360) / SPOKES);
</script>

<template>
  <svg v-if="agent === 'claude'" viewBox="0 0 24 24" class="h-[13px] w-[13px] flex-none" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line v-for="rotation in spokeRotations" :key="rotation" x1="12" y1="12" x2="12" y2="3.5" :transform="`rotate(${rotation} 12 12)`" />
    </g>
  </svg>
  <!-- Antigravity's four-point star, filled: at 14px an outline of it closes up into a smudge. -->
  <svg v-else-if="agent === 'antigravity'" viewBox="0 0 24 24" class="h-[14px] w-[14px] flex-none" fill="currentColor" aria-hidden="true">
    <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
  </svg>
  <!-- Grok's X: one unbroken diagonal, the other broken about the centre. The gap is the whole
       mark — drawn as a plain X it is indistinguishable from a close button, which is a bad thing
       for a badge sitting in a row of clickable chrome to resemble. -->
  <svg v-else-if="agent === 'grok'" viewBox="0 0 24 24" class="h-[14px] w-[14px] flex-none" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="20" y1="4" x2="4" y2="20" />
      <line x1="4" y1="4" x2="9.5" y2="9.5" />
      <line x1="14.5" y1="14.5" x2="20" y2="20" />
    </g>
  </svg>
  <!-- Muse: simple M with spark — three verticals with diagonals -->
  <svg v-else-if="agent === 'muse'" viewBox="0 0 24 24" class="h-[13px] w-[13px] flex-none" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 18V6l6 8 6-8v12" />
    </g>
  </svg>
  <!-- Two crossed loops, not three. The knot's own six-fold form was tried first and measured at
       the size it actually renders: three overlapping ellipses fill the middle in and the whole
       thing reads as one dark blob, which distinguishes nothing. Two loops keep an open centre and
       stay legible, at the cost of being a suggestion of the mark rather than a copy of it.

       The v-else, so codex is what an unrecognised agent looks like. Every caller passes a
       TerminalAgent, so that is unreachable rather than a fallback with a policy. -->
  <svg v-else viewBox="0 0 24 24" class="h-[14px] w-[14px] flex-none" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.5">
      <ellipse cx="12" cy="12" rx="4.5" ry="10" transform="rotate(45 12 12)" />
      <ellipse cx="12" cy="12" rx="4.5" ry="10" transform="rotate(-45 12 12)" />
    </g>
  </svg>
</template>

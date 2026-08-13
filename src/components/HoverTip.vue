<script setup lang="ts">
// The one hover tip on screen (#1235). Mounted once by App.vue; every cell-header chip opens THIS
// one through useHoverTip.
//
// Teleported to <body> and fixed-positioned for the same reason CockpitRowMenu is: a grid cell is
// `overflow-hidden`, so a tip left where its chip lives is clipped by the cell that owns the chip —
// which is exactly the cell whose header you are reading. Fixed also means it cannot widen a
// column: it overlays, so a narrow screen loses no room to it (the request).
//
// `font-sans` is spelled out for the same reason: this app sets no font on <body> (it renders
// Times), each element carries its own utility instead — so a teleported panel inherits the
// browser default and comes out in a serif nobody chose. Only visible in a real browser; jsdom
// resolves no fonts at all.
import { computed, nextTick, ref, watch, onBeforeUnmount, useTemplateRef, type CSSProperties } from "vue";
import { HOVER_TIP_ID, hideHoverTip, useHoverTipState } from "../composables/useHoverTip";
import { placeHoverTip } from "../composables/hoverTipPlacement";

const { tip } = useHoverTipState();
const box = useTemplateRef<HTMLElement>("box");
const pos = ref({ top: 0, left: 0 });
// Drawn only once it has been measured and placed, so the first frame is not painted at 0,0 and
// then jumped to where it belongs.
const placed = ref(false);

// Measured AFTER the content renders: the height depends on how many sections there are and on how
// far a PR title wraps, and placing it from a guess is what puts a two-line tip off the bottom of a
// short window.
watch(
  tip,
  async (open) => {
    placed.value = false;
    if (!open) return;
    await nextTick();
    const el = box.value;
    if (!el) return;
    pos.value = placeHoverTip(open.anchor, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    placed.value = true;
  },
  { flush: "post" },
);

// Anything that moves the chip out from under a fixed tip closes it. A scroll is the common one —
// the roster scrolls, the grid pages — and the capture phase catches the inner scrollers too. A
// pointerdown covers the case no leave event can: the chip's cell being closed under the pointer.
const CLOSING_EVENTS = ["scroll", "resize", "pointerdown"] as const;
const listenWhileOpen = (open: boolean): void => {
  CLOSING_EVENTS.forEach((name) => {
    if (open) window.addEventListener(name, hideHoverTip, true);
    else window.removeEventListener(name, hideHoverTip, true);
  });
};
watch(tip, (open) => listenWhileOpen(open !== null));
onBeforeUnmount(() => listenWhileOpen(false));

const style = computed<CSSProperties>(() => ({ top: `${pos.value.top}px`, left: `${pos.value.left}px`, visibility: placed.value ? "visible" : "hidden" }));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tip"
      :id="HOVER_TIP_ID"
      ref="box"
      data-testid="hover-tip"
      role="tooltip"
      class="pointer-events-none fixed z-[110] max-w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-border bg-panel px-2.5 py-1.5 font-sans text-[11px] leading-snug text-fg shadow-xl"
      :style="style"
    >
      <div v-for="(sec, i) in tip.content" :key="i" :class="i > 0 ? 'mt-1.5' : ''">
        <div data-testid="hover-tip-head" class="whitespace-nowrap font-semibold">{{ sec.head }}</div>
        <div v-if="sec.note" data-testid="hover-tip-note" class="mt-0.5 text-dim">{{ sec.note }}</div>
      </div>
    </div>
  </Teleport>
</template>

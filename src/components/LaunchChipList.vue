<script setup lang="ts">
// One of the "or …" rows under the launch form's directory field: the scripts a directory can
// run, and the launch commands configured for it. Both are a heading over a wrapped row of
// identical chips, differing only in the icon and in what a click means — written twice, the two
// drifted apart in nothing but their 100-character class string, which is the drift that shows.
defineProps<{
  heading: string;
  // Material Symbols name — `play_arrow` for a script, `rocket_launch` for a launcher.
  icon: string;
  // `title` is the command behind the chip, shown on hover.
  chips: { key: string | number; label: string; title: string }[];
}>();
const emit = defineEmits<{ (e: "pick", index: number): void }>();
</script>

<template>
  <div v-if="chips.length" class="flex w-full max-w-[360px] flex-col items-center gap-1.5">
    <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">{{ heading }}</span>
    <div class="flex w-full flex-wrap justify-center gap-1.5">
      <button
        v-for="(chip, i) in chips"
        :key="chip.key"
        data-testid="cell-script-item"
        class="inline-flex cursor-pointer items-center gap-1 rounded-[14px] border border-[#2a4e3a] bg-[#16271d] px-2.5 py-1 font-sans text-[12px] text-[#b6e3c7] hover:border-[#3fae6b] hover:bg-[#1f3a2a] hover:text-white"
        :title="chip.title"
        @click="emit('pick', i)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">{{ icon }}</span> {{ chip.label }}
      </button>
    </div>
  </div>
</template>

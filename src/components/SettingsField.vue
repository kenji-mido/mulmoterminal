<script setup lang="ts">
// The settings modal's shared text input. Wraps a v-model; placeholder,
// aria-label, spellcheck, @change / @keydown, and any extra layout classes
// (flex-auto, font-mono, …) fall through to the underlying <input>.
defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

function onInput(e: Event) {
  if (e.target instanceof HTMLInputElement) emit("update:modelValue", e.target.value);
}
</script>

<template>
  <input
    type="text"
    :value="modelValue"
    class="box-border rounded-md border border-border bg-input px-2.5 py-[7px] text-[12px] text-fg focus:border-accent focus:outline-none"
    @input="onInput"
  />
</template>

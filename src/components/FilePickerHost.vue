<script setup lang="ts">
// Mounted once (in App) so the app-wide in-browser file picker has somewhere to render. Shows
// the folder/file modal in file mode whenever a request is parked (openFilePicker), hands the
// chosen path back to that request's callback, and clears it. See useFilePicker.
import DirPickerModal from "./DirPickerModal.vue";
import { useFilePickerRequest, closeFilePicker } from "../composables/useFilePicker";

const request = useFilePickerRequest();

function onSelect(chosen: string): void {
  request.value?.onSelect([chosen]);
  closeFilePicker();
}
</script>

<template>
  <DirPickerModal v-if="request" mode="file" :start="request.start" @select="onSelect" @close="closeFilePicker" />
</template>

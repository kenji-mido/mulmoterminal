<script setup lang="ts">
import GuideLinks from "../GuideLinks.vue";
import { SECTION_HEADING } from "./sectionClasses";
</script>

<template>
  <h3 :class="SECTION_HEADING">Help &amp; user guide</h3>
  <GuideLinks />
</template>

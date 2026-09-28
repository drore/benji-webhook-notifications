<script setup lang="ts">
defineProps<{ paused?: boolean }>();
</script>

<template>
  <span class="live-dot" :class="{ 'is-paused': paused }" data-testid="live-dot" aria-hidden="true" />
</template>

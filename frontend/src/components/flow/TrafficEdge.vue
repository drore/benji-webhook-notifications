<script setup lang="ts">
import { computed } from "vue";

import type { EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps<{ color?: string; active?: boolean }>>();

/** A gentle S-curve, matching the rest of the canvas. */
const path = computed(() => {
  const { sourceX, sourceY, targetX, targetY } = props;
  const bend = Math.max(40, (targetX - sourceX) / 2);
  return `M ${sourceX},${sourceY} C ${sourceX + bend},${sourceY} ${targetX - bend},${targetY} ${targetX},${targetY}`;
});

const color = computed(() => props.data?.color ?? "#64748b");
const active = computed(() => props.data?.active === true);
</script>

<template>
  <g data-testid="flow-edge" :data-active="active ? 'true' : 'false'">
    <path :d="path" :stroke="color" stroke-width="2" fill="none" />
    <template v-if="active">
      <!-- Traffic: a dashed line that flows, plus a packet riding the same path. -->
      <path :d="path" :stroke="color" stroke-width="2" fill="none" class="flow-edge-flow" />
      <circle r="4" :fill="color" class="flow-edge-packet" data-testid="flow-packet">
        <animateMotion :path="path" dur="1.4s" repeatCount="indefinite" />
      </circle>
    </template>
  </g>
</template>

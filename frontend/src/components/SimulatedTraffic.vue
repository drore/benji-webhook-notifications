<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import type { DashboardApi } from "../api/client";
import { SIMULATOR_INTERVALS, createSimulatorState } from "../state/simulator";

const props = defineProps<{ api: DashboardApi }>();
const {
  running,
  intervalMs,
  eventType,
  availableTypes,
  published,
  error,
  loadTypes,
  toggle,
  stop,
  setIntervalMs,
} = createSimulatorState(props.api);

onMounted(loadTypes);
onUnmounted(stop);
</script>

<template>
  <div class="simulator">
    <label class="switch">
      <input
        type="checkbox"
        data-testid="simulate-traffic"
        :checked="running"
        @change="toggle"
      />
      Simulate traffic
    </label>
    <select
      aria-label="Simulated event type"
      :value="eventType"
      :disabled="running"
      @change="eventType = ($event.target as HTMLSelectElement).value"
    >
      <option v-for="type in availableTypes" :key="type" :value="type">{{ type }}</option>
      <option v-if="!availableTypes.length" :value="eventType">{{ eventType }}</option>
    </select>
    <select
      aria-label="Simulated interval"
      :value="intervalMs"
      :disabled="running"
      @change="setIntervalMs(Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="value in SIMULATOR_INTERVALS" :key="value" :value="value">
        every {{ value / 1000 }}s
      </option>
    </select>
    <span class="freshness" data-testid="simulator-status">
      {{
        running
          ? `pushing every ${intervalMs / 1000}s · ${published} sent`
          : published
            ? `stopped · ${published} sent`
            : "idle"
      }}
    </span>
    <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>
  </div>
</template>

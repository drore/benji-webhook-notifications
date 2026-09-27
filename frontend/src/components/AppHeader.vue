<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import type { DashboardApi } from "../api/client";
import { createOverviewState } from "../state/overview";

const props = defineProps<{ api: DashboardApi }>();
const { overview, stale, lastUpdatedAt, load, startPolling, stopPolling } =
  createOverviewState(props.api);

onMounted(async () => {
  await load();
  startPolling();
});
onUnmounted(() => stopPolling());
</script>

<template>
  <div class="app-header">
    <div class="signals">
      <span class="signal">
        Needs attention
        <strong data-testid="failed-count">{{ overview?.failed_count ?? 0 }}</strong>
      </span>
      <span class="signal">
        Retrying
        <strong data-testid="retrying-count">{{ overview?.retrying_count ?? 0 }}</strong>
        <small v-if="overview?.earliest_due_at"> next {{ overview.earliest_due_at }}</small>
      </span>
    </div>
    <p v-if="stale" data-testid="stale-banner" class="stale">
      Status may be stale — last updated {{ lastUpdatedAt?.toLocaleTimeString() ?? "never" }}.
    </p>
  </div>
</template>

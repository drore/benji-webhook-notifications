<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import type { DashboardApi } from "../api/client";
import { setStatusFilter } from "../state/filters";
import { freshnessLabel, frozen, now } from "../state/live";
import LiveDot from "./LiveDot.vue";
import { createOverviewState } from "../state/overview";

const props = defineProps<{ api: DashboardApi }>();
const { overview, stale, lastUpdatedAt, load, startPolling, stopPolling } =
  createOverviewState(props.api);

onMounted(async () => {
  await load();
  startPolling();
});
onUnmounted(() => stopPolling());

function formatDue(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="signals">
    <button
      type="button"
      class="signal-pill"
      :class="overview?.failed_count ? 'signal-danger' : 'signal-neutral'"
      data-testid="failed-signal"
      title="Show failed events"
      @click="setStatusFilter('failed')"
    >
      <span class="signal-dot" aria-hidden="true"></span>
      Needs attention
      <strong data-testid="failed-count">{{ overview?.failed_count ?? 0 }}</strong>
    </button>
    <button
      type="button"
      class="signal-pill signal-warn"
      data-testid="retrying-signal"
      title="Show retrying events"
      @click="setStatusFilter('retrying')"
    >
      <span class="signal-dot" aria-hidden="true"></span>
      Retrying
      <strong data-testid="retrying-count">{{ overview?.retrying_count ?? 0 }}</strong>
      <small v-if="overview?.earliest_due_at">next {{ formatDue(overview.earliest_due_at) }}</small>
    </button>
    <span class="freshness" data-testid="overview-freshness">
      <LiveDot :paused="frozen" />
      {{ freshnessLabel(lastUpdatedAt, frozen, now) }}
    </span>
    <span v-if="stale" data-testid="stale-banner" class="signal-pill signal-danger">
      <span class="signal-dot" aria-hidden="true"></span>
      Status may be stale — last updated
      {{ lastUpdatedAt?.toLocaleTimeString() ?? "never" }}
    </span>
  </div>
</template>

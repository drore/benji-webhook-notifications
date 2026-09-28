<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";

import type { DashboardApi } from "../api/client";
import { freshnessLabel, frozen, now } from "../state/live";
import LiveDot from "./LiveDot.vue";
import { TREND_WINDOWS, createTrendState } from "../state/trend";

const props = defineProps<{ api: DashboardApi }>();
const {
  types,
  eventType,
  hours,
  stats,
  loading,
  error,
  lastUpdatedAt,
  load,
  loadTypes,
  startPolling,
  stopPolling,
} = createTrendState(props.api);

onMounted(async () => {
  await Promise.all([loadTypes(), load()]);
  startPolling();
});
onUnmounted(stopPolling);

const CHART_WIDTH = 320;
const CHART_HEIGHT = 80;

const maxTotal = computed(() =>
  Math.max(1, ...(stats.value?.buckets ?? []).map((bucket) => bucket.deliveries)),
);

const bars = computed(() => {
  const buckets = stats.value?.buckets ?? [];
  if (!buckets.length) return [];
  const step = CHART_WIDTH / buckets.length;
  const width = Math.max(2, step - 2);
  const scale = (value: number) => (value / maxTotal.value) * CHART_HEIGHT;
  return buckets.map((bucket, index) => {
    const succeeded = scale(bucket.succeeded);
    const failed = scale(bucket.failed);
    const other = scale(bucket.deliveries - bucket.succeeded - bucket.failed);
    const label = new Date(bucket.start).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = [`${label}`, `${bucket.succeeded} delivered`];
    if (bucket.failed) parts.push(`${bucket.failed} failed`);
    if (bucket.retrying) parts.push(`${bucket.retrying} retrying`);
    if (bucket.pending) parts.push(`${bucket.pending} pending`);
    return {
      key: bucket.start,
      x: index * step + 1,
      width,
      succeededY: CHART_HEIGHT - succeeded,
      succeededHeight: succeeded,
      failedY: CHART_HEIGHT - succeeded - failed,
      failedHeight: failed,
      otherY: CHART_HEIGHT - succeeded - failed - other,
      otherHeight: other,
      title: parts.join(" · "),
    };
  });
});

const axisLabels = computed(() => {
  const buckets = stats.value?.buckets ?? [];
  if (!buckets.length) return [];
  const pick = (index: number) =>
    new Date(buckets[index].start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return [
    { key: "start", x: 2, label: pick(0) },
    { key: "middle", x: CHART_WIDTH / 2, label: pick(Math.floor(buckets.length / 2)) },
    { key: "end", x: CHART_WIDTH - 2, label: pick(buckets.length - 1) },
  ];
});

const successLabel = computed(() =>
  stats.value ? `${Math.round(stats.value.success_rate * 100)}% delivered` : "",
);

const attemptsLabel = computed(() => {
  const value = stats.value?.avg_attempts_per_delivery;
  return value === null || value === undefined ? "no attempts yet" : `${value} attempts per delivery`;
});

const durationLabel = computed(() => {
  const value = stats.value?.avg_attempt_ms;
  return value === null || value === undefined ? "no timing yet" : `${value} ms per attempt`;
});
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2>Delivery trend</h2>
      <div class="header-actions">
        <select v-model="eventType" aria-label="Event type for the trend" :disabled="loading">
          <option v-for="type in types" :key="type.name" :value="type.name">{{ type.name }}</option>
          <option v-if="!types.length" :value="eventType">{{ eventType }}</option>
        </select>
        <select v-model.number="hours" aria-label="Trend window" :disabled="loading">
          <option v-for="window in TREND_WINDOWS" :key="window.value" :value="window.value">
            {{ window.label }}
          </option>
        </select>
        <button type="button" class="btn btn-small" data-action="refresh-trend" @click="load">
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
      </div>
    </div>
    <p class="freshness" data-testid="trend-freshness">
      <LiveDot :paused="frozen" />
      {{ freshnessLabel(lastUpdatedAt, frozen, now, 10000) }}
    </p>
    <p class="card-hint">
      Deliveries of one event type over time, bucketed by the selected window. A delivery counts
      under its current status, so a recent bucket can still change.
    </p>
    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <template v-if="stats">
      <div class="trend-summary">
        <span class="signal-pill signal-neutral" data-testid="trend-deliveries">
          <span class="signal-dot" aria-hidden="true"></span>
          {{ stats.totals.deliveries }} deliveries
        </span>
        <span class="signal-pill signal-neutral" data-testid="trend-success">{{ successLabel }}</span>
        <span class="signal-pill" :class="stats.totals.failed ? 'signal-danger' : 'signal-neutral'">
          {{ stats.totals.failed }} failed
        </span>
        <span class="signal-pill signal-neutral">{{ attemptsLabel }}</span>
        <span class="signal-pill signal-neutral">{{ durationLabel }}</span>
      </div>
      <div v-if="!stats.totals.deliveries" class="empty-state" data-testid="trend-empty">
        No deliveries for <code>{{ stats.type }}</code> in the last
        {{ stats.hours === 168 ? "7 days" : `${stats.hours} hours` }}.
      </div>
      <svg
        v-else
        class="trend-chart"
        :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT + 16}`"
        role="img"
        :aria-label="`Delivery trend for ${stats.type}`"
        data-testid="trend-chart"
      >
        <g v-for="bar in bars" :key="bar.key" data-testid="trend-bar">
          <title>{{ bar.title }}</title>
          <rect
            :x="bar.x"
            :y="bar.otherY"
            :width="bar.width"
            :height="bar.otherHeight"
            class="trend-bar-other"
          />
          <rect
            :x="bar.x"
            :y="bar.failedY"
            :width="bar.width"
            :height="bar.failedHeight"
            class="trend-bar-failed"
          />
          <rect
            :x="bar.x"
            :y="bar.succeededY"
            :width="bar.width"
            :height="bar.succeededHeight"
            class="trend-bar-succeeded"
          />
        </g>
        <g class="trend-axis">
          <text v-for="tick in axisLabels" :key="tick.key" :x="tick.x" :y="CHART_HEIGHT + 12">
            {{ tick.label }}
          </text>
        </g>
      </svg>
    </template>
  </section>
</template>

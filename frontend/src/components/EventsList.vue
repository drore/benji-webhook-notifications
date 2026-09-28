<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { DashboardApi, Endpoint } from "../api/client";
import {
  STATUS_CHIPS,
  eventFilters,
  hasActiveFilter,
  resetEventFilters,
  setEndpointFilter,
  setStatusFilter,
  setTypeFilter,
} from "../state/filters";
import { createEventsState } from "../state/events";
import { freshnessLabel, frozen, now } from "../state/live";
import { setLatestEventId } from "../state/stream";
import LiveDot from "./LiveDot.vue";

const props = defineProps<{ api: DashboardApi; selectedEventId: string | null }>();
const emit = defineEmits<{ select: [eventId: string] }>();
const {
  events,
  total,
  loading,
  loadingMore,
  stale,
  lastUpdatedAt,
  error,
  load,
  loadMore,
  startPolling,
  stopPolling,
} = createEventsState(props.api);

const endpoints = ref<Endpoint[]>([]);

onMounted(async () => {
  await load();
  startPolling();
  try {
    endpoints.value = (await props.api.listEndpoints()).items;
  } catch {
    // The endpoint facet is optional tooling; the list still works without it.
  }
});
onUnmounted(() => stopPolling());

watch(
  events,
  (list) => setLatestEventId(list[0]?.id ?? null),
  { immediate: true },
);

const types = computed(() => {
  const seen = new Set(events.value.map((event) => event.type));
  if (eventFilters.type) seen.add(eventFilters.type);
  return [...seen].sort();
});

function onTypeChange(event: Event): void {
  setTypeFilter((event.target as HTMLSelectElement).value);
}

function onEndpointChange(event: Event): void {
  setEndpointFilter((event.target as HTMLSelectElement).value);
}

function age(createdAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2>Recent events</h2>
      <span class="freshness" data-testid="events-freshness">
        <LiveDot :paused="frozen" />
        {{ freshnessLabel(lastUpdatedAt, frozen, now) }}
      </span>
    </div>
    <p class="card-hint">Select an event to follow its journey above.</p>
    <div class="filter-bar">
      <button
        v-for="chip in STATUS_CHIPS"
        :key="chip.value"
        type="button"
        class="filter-chip"
        :class="{ active: eventFilters.status === chip.value }"
        :data-action="`filter-${chip.value}`"
        @click="setStatusFilter(chip.value)"
      >
        {{ chip.label }}
      </button>
      <select aria-label="Filter by type" :value="eventFilters.type" @change="onTypeChange">
        <option value="">All types</option>
        <option v-for="type in types" :key="type" :value="type">{{ type }}</option>
      </select>
      <select
        aria-label="Filter by endpoint"
        :value="eventFilters.endpointId"
        @change="onEndpointChange"
      >
        <option value="">All endpoints</option>
        <option v-for="endpoint in endpoints" :key="endpoint.id" :value="endpoint.id">
          {{ endpoint.name }}
        </option>
      </select>
      <button
        v-if="hasActiveFilter()"
        type="button"
        class="btn btn-small"
        data-action="clear-filters"
        @click="resetEventFilters()"
      >
        Clear
      </button>
    </div>
    <p v-if="stale" class="banner banner-warn" role="status">Event status may be stale.</p>
    <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>
    <p v-if="loading && !events.length" class="muted">Loading events…</p>
    <div v-else-if="!events.length" class="empty-state">
      <template v-if="hasActiveFilter()">
        No events match the current filter.
        <button type="button" class="btn btn-small" data-action="clear-filters" @click="resetEventFilters()">
          Clear filter
        </button>
      </template>
      <template v-else>No events yet — publish one on the right to see it fan out.</template>
    </div>
    <p v-if="events.length" class="event-count muted" data-testid="event-count">
      showing {{ events.length }} of {{ total }}
    </p>
    <ul v-if="events.length" class="event-list">
      <li
        v-for="event in events"
        :key="event.id"
        data-testid="event-row"
        class="event-row"
        :class="{ selected: event.id === selectedEventId }"
        @click="emit('select', event.id)"
      >
        <span class="event-type">{{ event.type }}</span>
        <code class="event-id">{{ event.id }}</code>
        <span class="event-age">{{ age(event.created_at) }}</span>
        <span class="counts">
          <span
            v-if="
              !event.deliveries.pending &&
              !event.deliveries.in_progress &&
              !event.deliveries.retrying &&
              !event.deliveries.succeeded &&
              !event.deliveries.failed &&
              !event.deliveries.paused
            "
            class="count-chip"
            data-testid="no-receivers-chip"
          >
            no receivers
          </span>
          <span v-if="event.deliveries.pending" class="count-chip">
            {{ event.deliveries.pending }} pending
          </span>
          <span v-if="event.deliveries.in_progress" class="count-chip">
            {{ event.deliveries.in_progress }} in progress
          </span>
          <span v-if="event.deliveries.retrying" class="count-chip warn">
            {{ event.deliveries.retrying }} retrying
          </span>
          <span v-if="event.deliveries.succeeded" class="count-chip ok">
            {{ event.deliveries.succeeded }} delivered
          </span>
          <span v-if="event.deliveries.failed" class="count-chip err">
            {{ event.deliveries.failed }} failed
          </span>
          <span v-if="event.deliveries.paused" class="count-chip paused">
            {{ event.deliveries.paused }} paused
          </span>
        </span>
      </li>
    </ul>
    <button
      v-if="events.length && events.length < total"
      type="button"
      class="btn btn-small"
      data-action="load-more"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ loadingMore ? "Loading…" : `Load more (${total - events.length} more)` }}
    </button>
  </section>
</template>

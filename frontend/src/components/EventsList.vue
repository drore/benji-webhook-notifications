<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import type { DashboardApi } from "../api/client";
import { createEventsState } from "../state/events";

const props = defineProps<{ api: DashboardApi; selectedEventId: string | null }>();
const emit = defineEmits<{ select: [eventId: string] }>();
const { events, loading, stale, error, load, startPolling, stopPolling } = createEventsState(
  props.api,
);

onMounted(async () => {
  await load();
  startPolling();
});
onUnmounted(() => stopPolling());

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
      <span class="muted" style="font-size: 12px">updates live every 2s</span>
    </div>
    <p class="card-hint">Select an event to follow its journey above.</p>
    <p v-if="stale" class="banner banner-warn">Event status may be stale.</p>
    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <p v-if="loading && !events.length" class="muted">Loading events…</p>
    <div v-else-if="!events.length" class="empty-state">
      No events yet — publish one on the right to see it fan out.
    </div>
    <ul v-else class="event-list">
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
  </section>
</template>

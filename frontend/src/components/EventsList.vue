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
</script>

<template>
  <section class="panel">
    <h2>Recent events</h2>
    <p v-if="stale" class="stale">Event status may be stale.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading && !events.length">Loading events…</p>
    <p v-else-if="!events.length">
      No events yet — publish one above to see it fan out.
    </p>
    <ul class="event-list">
      <li
        v-for="event in events"
        :key="event.id"
        data-testid="event-row"
        :class="{ selected: event.id === selectedEventId }"
        @click="emit('select', event.id)"
      >
        <span class="event-type">{{ event.type }}</span>
        <code class="event-id">{{ event.id }}</code>
        <span class="counts">
          <span v-if="event.deliveries.pending">{{ event.deliveries.pending }} pending</span>
          <span v-if="event.deliveries.retrying">{{ event.deliveries.retrying }} retrying</span>
          <span v-if="event.deliveries.succeeded">{{ event.deliveries.succeeded }} delivered</span>
          <span v-if="event.deliveries.failed">{{ event.deliveries.failed }} failed</span>
          <span v-if="event.deliveries.paused">{{ event.deliveries.paused }} paused</span>
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

import type { DashboardApi, EventDetail } from "../api/client";
import { STATUS_LABELS } from "../state/delivery";

const props = defineProps<{ api: DashboardApi; eventId: string | null }>();
const emit = defineEmits<{ "select-delivery": [deliveryId: string] }>();

const event = ref<EventDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let timer: number | null = null;

async function load(): Promise<void> {
  if (!props.eventId) {
    event.value = null;
    return;
  }
  loading.value = true;
  try {
    event.value = await props.api.getEvent(props.eventId);
    error.value = null;
  } catch {
    error.value = "Could not load the selected event.";
  } finally {
    loading.value = false;
  }
}

function startPolling(): void {
  stopPolling();
  timer = window.setInterval(() => {
    if (!document.hidden) void load();
  }, 2000);
}

function stopPolling(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

onMounted(async () => {
  await load();
  startPolling();
});
onUnmounted(stopPolling);
watch(() => props.eventId, load);
</script>

<template>
  <section class="panel">
    <h2>Delivery fan-out</h2>
    <p v-if="!eventId">Select an event to see its delivery branches.</p>
    <p v-if="loading">Loading event…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="event">
      <div class="event-card">
        <strong>{{ event.type }}</strong>
        <code>{{ event.id }}</code>
        <small>{{ event.created_at }}</small>
      </div>
      <div
        v-if="event.deliveries.length === 0"
        data-testid="no-receivers"
        class="empty"
      >
        No receivers matched this event — it is stored without deliveries.
      </div>
      <ul v-else class="branch-list">
        <li
          v-for="delivery in event.deliveries"
          :key="delivery.id"
          data-testid="branch"
          :data-status="delivery.status"
          :class="['branch', `status-${delivery.status}`]"
          @click="emit('select-delivery', delivery.id)"
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="branch-name">{{ delivery.endpoint_name }}</span>
          <span class="branch-status">{{ STATUS_LABELS[delivery.status] }}</span>
          <span class="branch-meta">{{ delivery.attempts_count }} attempt(s)</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";

import type { DashboardApi } from "../api/client";
import { attemptSummary, createDeliveryState, STATUS_LABELS } from "../state/delivery";

const props = defineProps<{ api: DashboardApi; deliveryId: string | null }>();
const { delivery, loading, error, replaying, replayError, load, replay } = createDeliveryState(
  props.api,
);

let timer: number | null = null;

function startPolling(): void {
  stopPolling();
  timer = window.setInterval(() => {
    if (!document.hidden && props.deliveryId) void load(props.deliveryId);
  }, 2000);
}

function stopPolling(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

watch(
  () => props.deliveryId,
  (id) => {
    if (id) void load(id);
  },
  { immediate: true },
);

onMounted(startPolling);
onUnmounted(stopPolling);

const canReplay = computed(
  () => delivery.value?.status === "failed" && delivery.value?.endpoint.enabled === true,
);
</script>

<template>
  <section class="panel">
    <h2>Delivery detail</h2>
    <p v-if="!deliveryId">Select a branch to inspect its attempts.</p>
    <p v-else-if="loading">Loading delivery…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="delivery">
      <dl class="delivery-facts">
        <dt>Endpoint</dt>
        <dd>{{ delivery.endpoint.name }} — <code>{{ delivery.endpoint.url }}</code></dd>
        <dt>State</dt>
        <dd :data-status="delivery.status">{{ STATUS_LABELS[delivery.status] }}</dd>
        <dt>Delivery ID</dt>
        <dd data-testid="delivery-id"><code>{{ delivery.id }}</code></dd>
        <dt>Next due</dt>
        <dd>{{ delivery.due_at ?? "—" }}</dd>
      </dl>
      <h3>Payload</h3>
      <pre data-testid="payload-json">{{ JSON.stringify(delivery.event.payload, null, 2) }}</pre>
      <h3>Attempts</h3>
      <p v-if="!delivery.attempts.length">No attempts recorded yet.</p>
      <ol class="attempt-list">
        <li
          v-for="attempt in delivery.attempts"
          :key="attempt.id"
          data-testid="attempt-row"
          :data-outcome="attempt.outcome"
        >
          <strong>#{{ attempt.number }}</strong>
          {{ attemptSummary(attempt.outcome, attempt.http_status) }}
          <small>started {{ attempt.started_at }}, finished {{ attempt.finished_at ?? "—" }}</small>
          <blockquote v-if="attempt.response_excerpt">{{ attempt.response_excerpt }}</blockquote>
        </li>
      </ol>
      <div class="replay-area">
        <button
          v-if="canReplay"
          type="button"
          data-action="replay"
          :disabled="replaying"
          @click="replay"
        >
          Replay delivery
        </button>
        <p
          v-else-if="delivery.status === 'failed' && !delivery.endpoint.enabled"
          data-testid="replay-unavailable"
        >
          Replay is unavailable while the endpoint is disabled. Resume it first.
        </p>
        <p v-else-if="delivery.status !== 'failed'" data-testid="replay-unavailable">
          Replay is available only for terminal failures.
        </p>
        <p v-if="replayError" class="error">{{ replayError }}</p>
      </div>
    </template>
  </section>
</template>

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

function outcomeTone(outcome: string | null): string {
  if (outcome === "success") return "success";
  if (outcome === "retryable_http" || outcome === "timeout" || outcome === "transport_error")
    return "retrying";
  if (outcome === "interrupted" || outcome === "policy_error" || outcome === "http_error")
    return "failed";
  return "pending";
}
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2>Delivery detail</h2>
      <span v-if="delivery" class="status-pill" :data-status="delivery.status">
        {{ STATUS_LABELS[delivery.status] }}
      </span>
    </div>
    <p class="card-hint">
      The attempt log for the selected branch. Replay only terminal failures; earlier attempts
      stay visible.
    </p>
    <p v-if="!deliveryId" class="empty-state">
      Select a branch in the journey above to inspect its payload and attempts.
    </p>
    <p v-else-if="loading && !delivery" class="muted">Loading delivery…</p>
    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <template v-if="delivery">
      <dl class="delivery-facts">
        <dt>Endpoint</dt>
        <dd>
          <strong>{{ delivery.endpoint.name }}</strong>
          <span v-if="!delivery.endpoint.enabled" class="status-pill" data-status="paused">disabled</span>
          <br />
          <code>{{ delivery.endpoint.url }}</code>
        </dd>
        <dt>Delivery ID</dt>
        <dd data-testid="delivery-id"><code>{{ delivery.id }}</code></dd>
        <dt>Event ID</dt>
        <dd><code>{{ delivery.event.id }}</code></dd>
        <dt>Next due</dt>
        <dd>{{ delivery.due_at ? new Date(delivery.due_at).toLocaleString() : "—" }}</dd>
      </dl>
      <h3 style="font-size: 14px; margin: 0 0 8px">Payload</h3>
      <pre data-testid="payload-json">{{ JSON.stringify(delivery.event.payload, null, 2) }}</pre>
      <h3 style="font-size: 14px; margin: 0 0 8px">Attempts</h3>
      <p v-if="!delivery.attempts.length" class="muted">No attempts recorded yet.</p>
      <ol v-else class="attempt-list">
        <li
          v-for="attempt in delivery.attempts"
          :key="attempt.id"
          data-testid="attempt-row"
          class="attempt-row"
          :data-outcome="attempt.outcome"
        >
          <div class="attempt-head">
            <span class="attempt-number">#{{ attempt.number }}</span>
            <span class="status-pill" :data-status="outcomeTone(attempt.outcome)">
              {{ attemptSummary(attempt.outcome, attempt.http_status) }}
            </span>
            <span class="attempt-time">
              {{ new Date(attempt.started_at).toLocaleTimeString() }} →
              {{ attempt.finished_at ? new Date(attempt.finished_at).toLocaleTimeString() : "…" }}
            </span>
          </div>
          <blockquote v-if="attempt.response_excerpt">{{ attempt.response_excerpt }}</blockquote>
        </li>
      </ol>
      <div class="replay-area">
        <button
          v-if="canReplay"
          type="button"
          class="btn btn-primary"
          data-action="replay"
          :disabled="replaying"
          @click="replay"
        >
          {{ replaying ? "Replaying…" : "Replay delivery" }}
        </button>
        <p
          v-else-if="delivery.status === 'failed' && !delivery.endpoint.enabled"
          data-testid="replay-unavailable"
          class="banner banner-warn"
        >
          Replay is unavailable while the endpoint is disabled. Resume it first.
        </p>
        <p v-else-if="delivery.status !== 'failed'" data-testid="replay-unavailable" class="muted">
          Replay becomes available if this delivery ends in failure.
        </p>
        <p v-if="replayError" class="banner banner-error">{{ replayError }}</p>
      </div>
    </template>
  </section>
</template>

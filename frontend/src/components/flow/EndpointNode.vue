<script setup lang="ts">
import type { DeliverySummary } from "../../api/client";
import {
  attemptExplanation,
  attemptProgress,
  attemptSummary,
  STATUS_GLYPHS,
  STATUS_LABELS,
} from "../../state/delivery";

defineProps<{ data: { delivery: DeliverySummary } }>();

function explain(delivery: DeliverySummary) {
  return attemptExplanation(delivery.last_outcome, delivery.last_http_status);
}
</script>

<template>
  <div
    class="flow-endpoint-node"
    data-testid="branch"
    :data-status="data.delivery.status"
  >
    <div class="flow-node-head">
      <span class="status-pill" :data-status="data.delivery.status">
        <span aria-hidden="true">{{ STATUS_GLYPHS[data.delivery.status] }}</span>
        {{ STATUS_LABELS[data.delivery.status] }}
      </span>
      <span class="flow-node-progress">
        {{
          attemptProgress(
            data.delivery.status,
            data.delivery.attempts_count,
            data.delivery.due_at,
          )
        }}
      </span>
    </div>
    <strong class="flow-node-name">{{ data.delivery.endpoint_name }}</strong>
    <code>{{ data.delivery.endpoint_url }}</code>
    <div
      v-if="data.delivery.last_outcome && data.delivery.status !== 'succeeded'"
      class="flow-node-outcome"
    >
      <span>Last: {{ attemptSummary(data.delivery.last_outcome, data.delivery.last_http_status) }}</span>
      <span class="attempt-help">
        <button
          type="button"
          class="attempt-help-trigger"
          data-testid="attempt-help"
          aria-label="Attempt explanation"
        >
          ?
        </button>
        <span class="tip" role="tooltip">
          <strong>{{ explain(data.delivery).title }}</strong>
          <span>{{ explain(data.delivery).meaning }}</span>
          <em>{{ explain(data.delivery).consequence }}</em>
        </span>
      </span>
    </div>
    <span class="flow-node-meta">Delivery {{ data.delivery.id }}</span>
  </div>
</template>

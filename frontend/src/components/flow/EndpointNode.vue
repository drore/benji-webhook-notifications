<script setup lang="ts">
import type { DeliverySummary } from "../../api/client";
import { STATUS_GLYPHS, STATUS_LABELS } from "../../state/delivery";

defineProps<{ data: { delivery: DeliverySummary } }>();
</script>

<template>
  <div
    class="flow-endpoint-node"
    data-testid="branch"
    :data-status="data.delivery.status"
  >
    <span class="status-pill" :data-status="data.delivery.status">
      <span aria-hidden="true">{{ STATUS_GLYPHS[data.delivery.status] }}</span>
      {{ STATUS_LABELS[data.delivery.status] }}
    </span>
    <strong>{{ data.delivery.endpoint_name }}</strong>
    <code>{{ data.delivery.endpoint_url }}</code>
    <span class="flow-node-meta">
      {{ data.delivery.attempts_count }} attempt(s) · {{ data.delivery.id }}
    </span>
  </div>
</template>

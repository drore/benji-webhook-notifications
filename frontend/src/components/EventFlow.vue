<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import type { Edge, Node } from "@vue-flow/core";
import { computed, nextTick, onMounted, onUnmounted, watch } from "vue";

import type { DashboardApi } from "../api/client";
import { STATUS_COLORS } from "../state/delivery";
import { createEventFlowState } from "../state/eventFlow";
import { freshnessLabel, frozen, now, refreshToken } from "../state/live";
import LiveDot from "./LiveDot.vue";
import EndpointNode from "./flow/EndpointNode.vue";
import EventNode from "./flow/EventNode.vue";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const props = defineProps<{ api: DashboardApi; eventId: string | null }>();
const emit = defineEmits<{ "select-delivery": [deliveryId: string] }>();

const {
  event,
  loading,
  error,
  lastUpdatedAt,
  replayingAll,
  replaySummary,
  load,
  replayFailed: replayAllFailed,
  startPolling,
  stopPolling,
} = createEventFlowState(props.api);

const failedDeliveries = computed(() =>
  (event.value?.deliveries ?? []).filter((delivery) => delivery.status === "failed"),
);

const { fitView } = useVueFlow();

onMounted(async () => {
  await load(props.eventId);
  startPolling(() => props.eventId);
});
onUnmounted(stopPolling);
watch(() => props.eventId, (eventId) => void load(eventId));
watch(refreshToken, () => void load(props.eventId));

const nodes = computed<Node[]>(() => {
  if (!event.value) return [];
  const list: Node[] = [
    {
      id: `event-${event.value.id}`,
      type: "event",
      position: { x: 0, y: 0 },
      data: { event: event.value },
      draggable: false,
      connectable: false,
    },
  ];
  event.value.deliveries.forEach((delivery, index) => {
    list.push({
      id: delivery.id,
      type: "endpoint",
      position: { x: 340, y: index * 124 },
      data: { delivery },
      draggable: false,
      connectable: false,
    });
  });
  return list;
});

const edges = computed<Edge[]>(() =>
  (event.value?.deliveries ?? []).map((delivery) => ({
    id: `edge-${delivery.id}`,
    source: `event-${event.value?.id}`,
    target: delivery.id,
    type: "smoothstep",
    animated: ["pending", "in_progress", "retrying"].includes(delivery.status),
    style: { stroke: STATUS_COLORS[delivery.status], strokeWidth: 2 },
    selectable: false,
    focusable: false,
  })),
);

const canvasHeight = computed(() =>
  Math.max(260, 120 + (event.value?.deliveries.length ?? 0) * 124),
);

async function fitSoon(): Promise<void> {
  await nextTick();
  fitView({ padding: 0.18, maxZoom: 1.1 });
}

onMounted(fitSoon);
watch(() => nodes.value.length, fitSoon);

function onNodeClick(payload: { node: Node }): void {
  if (payload.node.type === "endpoint") {
    emit("select-delivery", payload.node.id);
  }
}
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2>Event journey</h2>
      <span v-if="event" class="freshness" data-testid="journey-freshness">
        <LiveDot :paused="frozen" />
        {{ freshnessLabel(lastUpdatedAt, frozen, now) }}
      </span>
    </div>
    <p class="card-hint">
      One branch per matching endpoint. Click an endpoint node to inspect its attempts and
      payload.
    </p>
    <div v-if="event && failedDeliveries.length" class="journey-actions">
      <button
        type="button"
        class="btn btn-small"
        data-action="replay-all-failed"
        :disabled="replayingAll"
        @click="replayAllFailed"
      >
        {{ replayingAll ? "Replaying…" : `Replay all failed (${failedDeliveries.length})` }}
      </button>
      <span v-if="replaySummary" class="side-note" data-testid="replay-all-summary">
        {{ replaySummary }}
      </span>
    </div>
    <p v-if="!eventId" class="empty-state">
      Select an event from Recent events to follow its delivery journey.
    </p>
    <p v-if="loading && !event" class="muted">Loading event…</p>
    <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>
    <template v-if="event">
      <div v-if="event.deliveries.length === 0" data-testid="no-receivers" class="empty-state">
        No receivers matched this event — it is stored without deliveries.
      </div>
      <div v-else class="flow-canvas" :style="{ height: `${canvasHeight}px` }">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :elements-selectable="false"
          :min-zoom="0.4"
          :max-zoom="1.4"
          :fit-view-on-init="true"
          @node-click="onNodeClick"
        >
          <template #node-event="nodeProps">
            <EventNode v-bind="nodeProps" />
          </template>
          <template #node-endpoint="nodeProps">
            <EndpointNode v-bind="nodeProps" />
          </template>
          <Background :gap="20" :size="1.4" />
          <Controls :show-interactive="false" position="bottom-right" />
        </VueFlow>
      </div>
    </template>
  </section>
</template>

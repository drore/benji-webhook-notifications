<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import type { Edge, Node } from "@vue-flow/core";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import type { DashboardApi, EventDetail } from "../api/client";
import { STATUS_COLORS } from "../state/delivery";
import EndpointNode from "./flow/EndpointNode.vue";
import EventNode from "./flow/EventNode.vue";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const props = defineProps<{ api: DashboardApi; eventId: string | null }>();
const emit = defineEmits<{ "select-delivery": [deliveryId: string] }>();

const event = ref<EventDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let timer: number | null = null;

const { fitView } = useVueFlow();

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
      <span v-if="event" class="muted" style="font-size: 12px">live · updates every 2s</span>
    </div>
    <p class="card-hint">
      One branch per matching endpoint. Click an endpoint node to inspect its attempts and
      payload.
    </p>
    <p v-if="!eventId" class="empty-state">
      Select an event from Recent events to follow its delivery journey.
    </p>
    <p v-if="loading && !event" class="muted">Loading event…</p>
    <p v-if="error" class="banner banner-error">{{ error }}</p>
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

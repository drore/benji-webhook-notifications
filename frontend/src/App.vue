<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { ApiError, createDashboardApi } from "./api/client";
import AppHeader from "./components/AppHeader.vue";
import DeliveryPanel from "./components/DeliveryPanel.vue";
import DeliveryTrend from "./components/DeliveryTrend.vue";
import EndpointsPanel from "./components/EndpointsPanel.vue";
import EventComposer from "./components/EventComposer.vue";
import EventFlow from "./components/EventFlow.vue";
import EventsList from "./components/EventsList.vue";
import IdLookup from "./components/IdLookup.vue";
import PanelSlot from "./components/PanelSlot.vue";
import { frozen, requestRefresh, startClock, stopClock, toggleFrozen } from "./state/live";
import {
  DEFAULT_LAYOUT,
  PANEL_LABELS,
  isDefaultLayout,
  loadLayout,
  movePanel,
  saveLayout,
  shiftPanel,
} from "./state/panels";
import type { PanelKey, PanelLayout } from "./state/panels";
import { readSelection, selectionSearch } from "./state/location";
import type { Selection } from "./state/location";
import { followLive, latestEventId } from "./state/stream";

const api = createDashboardApi();
const status = ref("Checking API…");
const reachable = ref(false);

// The selection lives in the URL: reloading, bookmarking, or sharing a link
// restores the same journey/delivery view.
const initial = readSelection(window.location.search);
const selectedEventId = ref<string | null>(initial.eventId);
const selectedDeliveryId = ref<string | null>(initial.deliveryId);

const layout = ref<PanelLayout>(loadLayout(window.localStorage));

watch(layout, (value) => saveLayout(value, window.localStorage), { deep: true });

function columnOf(key: PanelKey): keyof PanelLayout {
  return layout.value.left.includes(key) ? "left" : "right";
}

function positionOf(key: PanelKey): number {
  return layout.value[columnOf(key)].indexOf(key);
}

/**
 * Panels are reordered with CSS `order`, so a swap would otherwise jump. FLIP:
 * measure before, mutate, measure after, then animate each slot from its old
 * position to its new one.
 */
async function withFlip(mutate: () => void): Promise<void> {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const before = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>("[data-panel-key]").forEach((slot) => {
    before.set(slot.dataset.panelKey ?? "", slot.getBoundingClientRect());
  });

  mutate();
  await nextTick();
  if (reduceMotion) return;

  document.querySelectorAll<HTMLElement>("[data-panel-key]").forEach((slot) => {
    const first = before.get(slot.dataset.panelKey ?? "");
    if (!first) return;
    const last = slot.getBoundingClientRect();
    const delta = first.top - last.top;
    if (Math.abs(delta) < 1) return;
    slot.style.transition = "none";
    slot.style.transform = `translateY(${delta}px)`;
    void slot.offsetHeight; // flush the starting position before animating
    requestAnimationFrame(() => {
      slot.style.transition = "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      slot.style.transform = "";
    });
  });
}

function movePanelTo(key: PanelKey, target: PanelKey): void {
  if (key === target) return;
  const from = columnOf(key);
  const to = columnOf(target);
  if (from === to) {
    const nextOrder = movePanel(layout.value[from], key, target);
    if (nextOrder === layout.value[from]) return;
    void withFlip(() => {
      layout.value[from] = nextOrder;
    });
    return;
  }
  void withFlip(() => {
    layout.value[from] = layout.value[from].filter((item) => item !== key);
    const targetColumn = [...layout.value[to]];
    targetColumn.splice(targetColumn.indexOf(target), 0, key);
    layout.value[to] = targetColumn;
  });
}

function resetLayout(): void {
  void withFlip(() => {
    layout.value = structuredClone(DEFAULT_LAYOUT);
  });
}

// "Follow live" moves the selection to each new event, which the URL keeps in
// step. Turning it off leaves the operator wherever they were.
watch([followLive, latestEventId], ([following, newest]) => {
  if (!following || !newest || newest === selectedEventId.value) return;
  applySelection({ eventId: newest, deliveryId: null });
});

function shiftPanelBy(key: PanelKey, delta: number): void {
  const column = columnOf(key);
  const nextOrder = shiftPanel(layout.value[column], key, delta);
  if (nextOrder === layout.value[column]) return;
  void withFlip(() => {
    layout.value[column] = nextOrder;
  });
}

watch([selectedEventId, selectedDeliveryId], ([eventId, deliveryId]) => {
  const search = selectionSearch({ eventId, deliveryId });
  if (search === window.location.search) return;
  window.history.pushState(null, "", search || window.location.pathname);
});

function applySelection(selection: Selection): void {
  selectedEventId.value = selection.eventId;
  selectedDeliveryId.value = selection.deliveryId;
}

function onPopState(): void {
  applySelection(readSelection(window.location.search));
}

onMounted(() => window.addEventListener("popstate", onPopState));
onUnmounted(() => window.removeEventListener("popstate", onPopState));

onMounted(startClock);
onUnmounted(stopClock);

onMounted(async () => {
  try {
    const health = await api.getHealth();
    reachable.value = health.status === "ok";
    status.value = reachable.value ? "API reachable" : "API unhealthy";
  } catch (cause) {
    reachable.value = false;
    status.value = cause instanceof ApiError ? cause.message : "API unreachable";
  }
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">B</span>
        <div>
          <h1>Webhook operations</h1>
          <p class="brand-sub">Local demo · loopback only · single customer</p>
        </div>
      </div>
      <div class="topbar-tools">
        <AppHeader :api="api" />
        <IdLookup :api="api" @select="applySelection" />
        <div class="live-controls">
          <button
            type="button"
            class="btn btn-small"
            data-testid="freeze-toggle"
            @click="toggleFrozen"
          >
            {{ frozen ? "Resume live updates" : "Pause live updates" }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-small"
            data-testid="refresh-now"
            @click="requestRefresh"
          >
            Refresh now
          </button>
          <button
            v-if="!isDefaultLayout(layout)"
            type="button"
            class="btn btn-ghost btn-small"
            data-testid="reset-layout"
            @click="resetLayout"
          >
            Reset layout
          </button>
        </div>
      </div>
    </header>
    <p v-if="!reachable" data-testid="api-status" class="banner banner-error" role="alert">
      {{ status }}
    </p>
    <main class="layout">
      <div class="column">
        <PanelSlot
          panel-key="journey"
          :label="PANEL_LABELS.journey"
          :style="{ order: positionOf('journey') }"
          @move="movePanelTo($event.key as PanelKey, $event.target as PanelKey)"
          @shift="shiftPanelBy($event.key as PanelKey, $event.delta)"
        >
          <EventFlow
            :api="api"
            :event-id="selectedEventId"
            @select-delivery="selectedDeliveryId = $event"
          />
        </PanelSlot>
        <PanelSlot
          panel-key="delivery"
          :label="PANEL_LABELS.delivery"
          :style="{ order: positionOf('delivery') }"
          @move="movePanelTo($event.key as PanelKey, $event.target as PanelKey)"
          @shift="shiftPanelBy($event.key as PanelKey, $event.delta)"
        >
          <DeliveryPanel :api="api" :delivery-id="selectedDeliveryId" />
        </PanelSlot>
        <PanelSlot
          panel-key="events"
          :label="PANEL_LABELS.events"
          :style="{ order: positionOf('events') }"
          @move="movePanelTo($event.key as PanelKey, $event.target as PanelKey)"
          @shift="shiftPanelBy($event.key as PanelKey, $event.delta)"
        >
          <EventsList
            :api="api"
            :selected-event-id="selectedEventId"
            @select="applySelection({ eventId: $event, deliveryId: null })"
          />
        </PanelSlot>
        <PanelSlot
          panel-key="trend"
          :label="PANEL_LABELS.trend"
          :style="{ order: positionOf('trend') }"
          @move="movePanelTo($event.key as PanelKey, $event.target as PanelKey)"
          @shift="shiftPanelBy($event.key as PanelKey, $event.delta)"
        >
          <DeliveryTrend :api="api" />
        </PanelSlot>
      </div>
      <aside class="column">
        <PanelSlot
          panel-key="composer"
          :label="PANEL_LABELS.composer"
          :style="{ order: positionOf('composer') }"
          @move="movePanelTo($event.key as PanelKey, $event.target as PanelKey)"
          @shift="shiftPanelBy($event.key as PanelKey, $event.delta)"
        >
          <EventComposer :api="api" />
        </PanelSlot>
        <PanelSlot
          panel-key="endpoints"
          :label="PANEL_LABELS.endpoints"
          :style="{ order: positionOf('endpoints') }"
          @move="movePanelTo($event.key as PanelKey, $event.target as PanelKey)"
          @shift="shiftPanelBy($event.key as PanelKey, $event.delta)"
        >
          <EndpointsPanel :api="api" />
        </PanelSlot>
      </aside>
    </main>
  </div>
</template>

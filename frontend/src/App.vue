<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

import { ApiError, createDashboardApi } from "./api/client";
import AppHeader from "./components/AppHeader.vue";
import DeliveryPanel from "./components/DeliveryPanel.vue";
import EndpointsPanel from "./components/EndpointsPanel.vue";
import EventComposer from "./components/EventComposer.vue";
import EventFlow from "./components/EventFlow.vue";
import EventsList from "./components/EventsList.vue";
import IdLookup from "./components/IdLookup.vue";
import { readSelection, selectionSearch } from "./state/location";
import type { Selection } from "./state/location";

const api = createDashboardApi();
const status = ref("Checking API…");
const reachable = ref(false);

// The selection lives in the URL: reloading, bookmarking, or sharing a link
// restores the same journey/delivery view.
const initial = readSelection(window.location.search);
const selectedEventId = ref<string | null>(initial.eventId);
const selectedDeliveryId = ref<string | null>(initial.deliveryId);

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
      </div>
    </header>
    <p v-if="!reachable" data-testid="api-status" class="banner banner-error">
      {{ status }}
    </p>
    <main class="layout">
      <div class="column">
        <EventFlow
          :api="api"
          :event-id="selectedEventId"
          @select-delivery="selectedDeliveryId = $event"
        />
        <DeliveryPanel :api="api" :delivery-id="selectedDeliveryId" />
        <EventsList
          :api="api"
          :selected-event-id="selectedEventId"
          @select="applySelection({ eventId: $event, deliveryId: null })"
        />
      </div>
      <aside class="column">
        <EventComposer :api="api" />
        <EndpointsPanel :api="api" />
      </aside>
    </main>
  </div>
</template>

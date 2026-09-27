<script setup lang="ts">
import { onMounted, ref } from "vue";

import { ApiError, createDashboardApi } from "./api/client";
import AppHeader from "./components/AppHeader.vue";
import DeliveryPanel from "./components/DeliveryPanel.vue";
import EndpointsPanel from "./components/EndpointsPanel.vue";
import EventComposer from "./components/EventComposer.vue";
import EventFlow from "./components/EventFlow.vue";
import EventsList from "./components/EventsList.vue";

const api = createDashboardApi();
const status = ref("Checking API…");
const reachable = ref(false);
const selectedEventId = ref<string | null>(null);
const selectedDeliveryId = ref<string | null>(null);

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
      <AppHeader :api="api" />
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
          @select="
            selectedEventId = $event;
            selectedDeliveryId = null;
          "
        />
      </div>
      <aside class="column">
        <EventComposer :api="api" />
        <EndpointsPanel :api="api" />
      </aside>
    </main>
  </div>
</template>

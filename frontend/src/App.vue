<script setup lang="ts">
import { onMounted, ref } from "vue";

import { ApiError, createDashboardApi } from "./api/client";
import AppHeader from "./components/AppHeader.vue";
import EndpointsPanel from "./components/EndpointsPanel.vue";
import EventComposer from "./components/EventComposer.vue";
import EventsList from "./components/EventsList.vue";

const api = createDashboardApi();
const status = ref("Checking API…");
const reachable = ref(false);
const selectedEventId = ref<string | null>(null);

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
  <header>
    <h1>Benji webhook operations</h1>
    <p data-testid="api-status" :hidden="reachable">{{ status }}</p>
  </header>
  <main>
    <AppHeader :api="api" />
    <div class="layout">
      <div class="column">
        <EventComposer :api="api" />
        <EventsList
          :api="api"
          :selected-event-id="selectedEventId"
          @select="selectedEventId = $event"
        />
      </div>
      <div class="column">
        <EndpointsPanel :api="api" />
      </div>
    </div>
  </main>
</template>

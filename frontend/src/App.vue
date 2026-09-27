<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, createDashboardApi } from "./api/client";

const api = createDashboardApi();
const status = ref("Checking API…");
const reachable = ref(false);

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
</template>

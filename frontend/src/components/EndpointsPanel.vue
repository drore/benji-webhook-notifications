<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

import type { DashboardApi } from "../api/client";
import { createEndpointsState } from "../state/endpoints";

const props = defineProps<{ api: DashboardApi }>();
const {
  endpoints,
  loading,
  error,
  creating,
  togglingId,
  createdSecret,
  load,
  create,
  setEnabled,
  dismissSecret,
  startPolling,
  stopPolling,
} = createEndpointsState(props.api);

const name = ref("");
const url = ref("");
const eventTypes = ref("");

onMounted(async () => {
  await load();
  startPolling();
});
onUnmounted(() => stopPolling());

async function submit(): Promise<void> {
  const types = eventTypes.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const ok = await create({ name: name.value, url: url.value, event_types: types });
  if (ok) {
    name.value = "";
    url.value = "";
    eventTypes.value = "";
  }
}
</script>

<template>
  <section class="panel">
    <h2>Endpoints</h2>
    <form class="endpoint-form" @submit.prevent="submit">
      <label>
        Name
        <input aria-label="Endpoint name" v-model="name" :disabled="creating" />
      </label>
      <label>
        URL
        <input
          aria-label="Endpoint URL"
          v-model="url"
          placeholder="http://127.0.0.1:9000/webhooks/crm"
          :disabled="creating"
        />
      </label>
      <label>
        Event types
        <input
          aria-label="Event types"
          v-model="eventTypes"
          placeholder="reward_transaction_created, campaign_updated"
          :disabled="creating"
        />
      </label>
      <button
        type="button"
        data-action="create-endpoint"
        :disabled="creating"
        @click="submit"
      >
        Create endpoint
      </button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="createdSecret" data-testid="secret-banner" class="secret-banner">
      <p>Copy this signing secret into the receiver now — it will not be shown again.</p>
      <code>{{ createdSecret.secret }}</code>
      <button type="button" data-action="dismiss-secret" @click="dismissSecret">Dismiss</button>
    </div>
    <p v-if="loading && !endpoints.length">Loading endpoints…</p>
    <p v-else-if="!endpoints.length">
      No endpoints yet — create one to start receiving events.
    </p>
    <ul class="endpoint-list">
      <li v-for="endpoint in endpoints" :key="endpoint.id">
        <span class="endpoint-name">{{ endpoint.name }}</span>
        <code class="endpoint-url">{{ endpoint.url }}</code>
        <span class="endpoint-state">{{ endpoint.enabled ? "enabled" : "disabled" }}</span>
        <button
          v-if="endpoint.enabled"
          type="button"
          data-action="disable-endpoint"
          :disabled="togglingId === endpoint.id"
          @click="setEnabled(endpoint.id, false)"
        >
          Disable
        </button>
        <button
          v-else
          type="button"
          data-action="enable-endpoint"
          :disabled="togglingId === endpoint.id"
          @click="setEnabled(endpoint.id, true)"
        >
          Enable
        </button>
      </li>
    </ul>
  </section>
</template>

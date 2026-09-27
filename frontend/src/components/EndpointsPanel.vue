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
const eventTypes = ref("");
const copied = ref(false);

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
  const ok = await create({ name: name.value, event_types: types });
  if (ok) {
    name.value = "";
    eventTypes.value = "";
  }
}

async function copySecret(): Promise<void> {
  if (!createdSecret.value) return;
  try {
    await navigator.clipboard.writeText(createdSecret.value.secret);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2>Endpoints</h2>
      <span class="muted" style="font-size: 12px">subscriptions · signing secrets</span>
    </div>
    <p class="card-hint">
      Name the destination and pick the event types it cares about. Its receiver URL is generated
      automatically; the one-time signing secret appears on creation.
    </p>
    <form class="endpoint-form" @submit.prevent="submit">
      <label>
        Name
        <input aria-label="Endpoint name" v-model="name" placeholder="Partner CRM" :disabled="creating" />
      </label>
      <label>
        Event types (comma-separated)
        <input
          aria-label="Event types"
          v-model="eventTypes"
          placeholder="reward_transaction_created, campaign_updated"
          :disabled="creating"
        />
      </label>
      <button type="button" class="btn btn-primary" data-action="create-endpoint" :disabled="creating" @click="submit">
        {{ creating ? "Creating…" : "Create endpoint" }}
      </button>
    </form>
    <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>
    <div v-if="createdSecret" data-testid="secret-banner" class="secret-banner">
      <strong>Signing secret — shown once.</strong> Copy it into the receiver's config page now.
      <div>
        <code>{{ createdSecret.secret }}</code>
      </div>
      <div class="secret-actions">
        <button type="button" class="btn btn-small" @click="copySecret">
          {{ copied ? "Copied" : "Copy secret" }}
        </button>
        <button type="button" class="btn btn-small" data-action="dismiss-secret" @click="dismissSecret">
          Dismiss
        </button>
      </div>
    </div>
    <p v-if="loading && !endpoints.length" class="muted">Loading endpoints…</p>
    <div v-else-if="!endpoints.length" class="empty-state">
      No endpoints yet. To start receiving webhooks:
      <ol>
        <li>Create an endpoint below (name and event types).</li>
        <li>Copy its one-time secret into the receiver page and choose a behavior.</li>
        <li>Enable the endpoint — new matching events will route to it.</li>
      </ol>
    </div>
    <ul v-else class="endpoint-list">
      <li v-for="endpoint in endpoints" :key="endpoint.id" class="endpoint-row">
        <span class="endpoint-name">{{ endpoint.name }}</span>
        <code class="endpoint-url">{{ endpoint.url }}</code>
        <span class="endpoint-state">{{ endpoint.enabled ? "enabled" : "disabled" }}</span>
        <button
          v-if="endpoint.enabled"
          type="button"
          class="btn btn-small"
          data-action="disable-endpoint"
          :disabled="togglingId === endpoint.id"
          @click="setEnabled(endpoint.id, false)"
        >
          Disable
        </button>
        <button
          v-else
          type="button"
          class="btn btn-small"
          data-action="enable-endpoint"
          :disabled="togglingId === endpoint.id"
          @click="setEnabled(endpoint.id, true)"
        >
          Enable
        </button>
      </li>
    </ul>
    <p class="side-note">
      Disabling stops new routing and pauses this endpoint's queued deliveries until you resume
      it. Disabled endpoints also block replay.
    </p>
  </section>
</template>

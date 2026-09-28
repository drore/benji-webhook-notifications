<script setup lang="ts">
import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi } from "../api/client";
import { isDeliveryId, isEventId } from "../state/location";

const props = defineProps<{ api: DashboardApi }>();
const emit = defineEmits<{ select: [{ eventId: string; deliveryId: string | null }] }>();

const value = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

function describe(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.httpStatus === 404) return fallback;
  if (cause instanceof ApiError) return cause.message;
  return "Unexpected error.";
}

async function submit(): Promise<void> {
  if (busy.value) return;
  const id = value.value.trim();
  error.value = null;

  if (isEventId(id)) {
    busy.value = true;
    try {
      await props.api.getEvent(id);
      emit("select", { eventId: id, deliveryId: null });
      value.value = "";
    } catch (cause) {
      error.value = describe(cause, "No event with that ID.");
    } finally {
      busy.value = false;
    }
    return;
  }

  if (isDeliveryId(id)) {
    busy.value = true;
    try {
      const delivery = await props.api.getDelivery(id);
      emit("select", { eventId: delivery.event.id, deliveryId: id });
      value.value = "";
    } catch (cause) {
      error.value = describe(cause, "No delivery with that ID.");
    } finally {
      busy.value = false;
    }
    return;
  }

  error.value = "Enter an event (evt_…) or delivery (dlv_…) ID.";
}
</script>

<template>
  <form class="lookup" @submit.prevent="submit">
    <label class="lookup-label" for="id-lookup">Find by ID</label>
    <input
      id="id-lookup"
      aria-label="Find by ID"
      placeholder="evt_… or dlv_…"
      v-model="value"
      :disabled="busy"
    />
    <button type="submit" class="btn btn-small" data-action="lookup" :disabled="busy">Find</button>
    <span v-if="error" class="lookup-error" role="alert">{{ error }}</span>
  </form>
</template>

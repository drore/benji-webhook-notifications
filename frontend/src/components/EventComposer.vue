<script setup lang="ts">
import { ref } from "vue";

import type { DashboardApi } from "../api/client";
import { createComposerState } from "../state/composer";

const props = defineProps<{ api: DashboardApi }>();
const { eventType, payloadText, submissionKey, submitting, outcome, submit, newKey } =
  createComposerState(props.api);

const BENJI_TYPES = [
  { value: "reward_transaction_created", label: "reward_transaction_created — reward transaction recorded" },
  { value: "campaign_updated", label: "campaign_updated — campaign configuration changed" },
  { value: "member_account_linked", label: "member_account_linked — member account linked" },
  { value: "custom", label: "Custom event type…" },
];
const customType = ref("");

function effectiveType(): string {
  return eventType.value === "custom" ? customType.value : eventType.value;
}

function submitEvent(): void {
  if (eventType.value === "custom") eventType.value = customType.value;
  void submit();
}
</script>

<template>
  <section class="panel">
    <h2>Publish a test event</h2>
    <form class="composer-form" @submit.prevent="submitEvent">
      <label>
        Event type
        <select v-model="eventType" aria-label="Event type">
          <option v-for="option in BENJI_TYPES" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label v-if="eventType === 'custom'">
        Custom type
        <input v-model="customType" aria-label="Custom event type" :disabled="submitting" />
      </label>
      <label>
        Payload (JSON)
        <textarea v-model="payloadText" aria-label="Payload" rows="5" :disabled="submitting" />
      </label>
      <label>
        Submission key
        <input :value="submissionKey" data-testid="submission-key" readonly />
      </label>
      <div class="composer-actions">
        <button type="button" data-action="submit-event" :disabled="submitting" @click="submitEvent">
          Publish event
        </button>
        <button type="button" data-action="new-key" :disabled="submitting" @click="newKey">
          New key
        </button>
      </div>
    </form>
    <p v-if="outcome?.kind === 'accepted'" data-testid="accepted">
      Accepted as <code>{{ outcome.eventId }}</code>. It will fan out to matching endpoints.
    </p>
    <p v-else-if="outcome?.kind === 'deduplicated'" data-testid="deduplicated">
      Already accepted: <code>{{ outcome.eventId }}</code> (deduplicated resubmission; no new
      deliveries).
    </p>
    <p v-else-if="outcome?.kind === 'conflict'" data-testid="conflict" class="error">
      {{ outcome.message }}
    </p>
    <div v-else-if="outcome?.kind === 'uncertain'" data-testid="uncertain" class="uncertain">
      <p>{{ outcome.message }} The submission result is unknown.</p>
      <button type="button" data-action="check-resend" :disabled="submitting" @click="submit">
        Check or resend submission
      </button>
      <button type="button" data-action="new-key" :disabled="submitting" @click="newKey">
        Start a new submission key
      </button>
    </div>
    <p v-else-if="outcome?.kind === 'error'" class="error">{{ outcome.message }}</p>
  </section>
</template>

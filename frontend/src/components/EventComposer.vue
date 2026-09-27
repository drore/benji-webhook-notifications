<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { DashboardApi } from "../api/client";
import { createComposerState } from "../state/composer";

const props = defineProps<{ api: DashboardApi }>();
const {
  eventType,
  payloadText,
  submissionKey,
  submitting,
  outcome,
  matchCount,
  refreshMatches,
  updateKey,
  submit,
  newKey,
} = createComposerState(props.api);

const BENJI_TYPES = [
  {
    value: "reward_transaction_created",
    label: "reward_transaction_created — reward transaction recorded",
  },
  { value: "campaign_updated", label: "campaign_updated — campaign configuration changed" },
  { value: "member_account_linked", label: "member_account_linked — member account linked" },
  { value: "custom", label: "Custom event type…" },
];
const customType = ref("");

const effectiveType = computed(() =>
  eventType.value === "custom" ? customType.value : eventType.value,
);

let timer: number | null = null;

watch(effectiveType, (type) => void refreshMatches(type), { immediate: true });

onMounted(() => {
  timer = window.setInterval(() => {
    if (!document.hidden) void refreshMatches(effectiveType.value);
  }, 2000);
});
onUnmounted(() => {
  if (timer !== null) window.clearInterval(timer);
});

function submitEvent(): void {
  void submit(effectiveType.value);
}
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2>Publish test event</h2>
    </div>
    <p class="card-hint">
      Sends one event to every enabled endpoint whose subscriptions match its type. The
      submission key makes retries safe: resending the same key and payload returns the original
      event.
    </p>
    <form class="form-grid" @submit.prevent="submitEvent">
      <label>
        Event type
        <select v-model="eventType" aria-label="Event type" :disabled="submitting">
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
        <textarea
          v-model="payloadText"
          aria-label="Payload"
          rows="6"
          spellcheck="false"
          :disabled="submitting"
        />
      </label>
      <label>
        Submission key
        <input
          :value="submissionKey"
          data-testid="submission-key"
          @input="updateKey(($event.target as HTMLInputElement).value)"
        />
      </label>
      <p class="side-note" style="margin: 0">
        A fresh key is generated after each accepted event. Edit it to reuse a key deliberately —
        resending the same key and payload shows deduplication; changing the payload under the
        same key shows a conflict.
      </p>
      <div class="form-row">
        <button
          type="button"
          class="btn btn-primary"
          data-action="submit-event"
          aria-label="Publish event"
          :disabled="submitting"
          @click="submitEvent"
        >
          {{ submitting ? "Publishing…" : "Publish event" }}
        </button>
        <button type="button" class="btn btn-ghost" data-action="new-key" :disabled="submitting" @click="newKey">
          New key
        </button>
      </div>
      <p v-if="matchCount === 0" class="banner banner-warn" data-testid="no-subscribers">
        No enabled endpoint subscribes to <code>{{ effectiveType }}</code> yet — publishing
        stores the event with no deliveries.
      </p>
      <p v-else-if="matchCount" class="side-note" data-testid="subscriber-hint">
        {{ matchCount }} enabled endpoint(s) will receive this event.
      </p>
    </form>
    <p v-if="outcome?.kind === 'accepted'" data-testid="accepted" class="banner banner-success" style="margin-top: 12px">
      Accepted as <code>{{ outcome.eventId }}</code> — it will fan out to matching endpoints.
    </p>
    <p
      v-else-if="outcome?.kind === 'deduplicated'"
      data-testid="deduplicated"
      class="banner banner-info"
      style="margin-top: 12px"
    >
      Already accepted as <code>{{ outcome.eventId }}</code> — deduplicated resubmission, no new
      deliveries.
    </p>
    <p v-else-if="outcome?.kind === 'conflict'" data-testid="conflict" class="banner banner-error" style="margin-top: 12px">
      {{ outcome.message }}
    </p>
    <div
      v-else-if="outcome?.kind === 'uncertain'"
      data-testid="uncertain"
      class="banner banner-warn"
      style="margin-top: 12px"
    >
      <span>{{ outcome.message }} The submission result is unknown.</span>
      <span class="banner-actions">
        <button type="button" class="btn btn-small" data-action="check-resend" :disabled="submitting" @click="submit()">
          Check or resend submission
        </button>
        <button type="button" class="btn btn-small" data-action="new-key" :disabled="submitting" @click="newKey">
          Start a new submission key
        </button>
      </span>
    </div>
    <p v-else-if="outcome?.kind === 'error'" class="banner banner-error" style="margin-top: 12px">
      {{ outcome.message }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { DashboardApi } from "../api/client";
import { createComposerState } from "../state/composer";
import SimulatedTraffic from "./SimulatedTraffic.vue";

const props = defineProps<{ api: DashboardApi }>();
const {
  eventType,
  payloadText,
  submissionKey,
  submitting,
  outcome,
  matchCount,
  eventTypes,
  enforceSchema,
  loadEventTypes,
  schemaFor,
  setEnforceSchema,
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

// The registry describes the types that carry a payload contract. Built-in demo
// presets that have no schema yet stay selectable, and a fallback list keeps the
// composer usable when the registry cannot be read at all.
const typeOptions = computed(() => {
  const registered = new Set(eventTypes.value.map((item) => item.name));
  const presets = BENJI_TYPES.filter(
    (option) => option.value === "custom" || !registered.has(option.value),
  );
  if (!eventTypes.value.length) return presets;
  return [
    ...eventTypes.value.map((item) => ({
      value: item.name,
      label: `${item.name} — ${item.description}`,
    })),
    ...presets,
  ];
});

const effectiveSchema = computed(() => schemaFor(effectiveType.value));

const expectedShape = computed(() => {
  const schema = effectiveSchema.value?.schema;
  if (!schema?.properties) return "";
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties)
    .map(
      ([name, definition]) =>
        `${name} (${definition.type ?? "any"}${required.has(name) ? "" : ", optional"})`,
    )
    .join(", ");
});

const registeredNames = computed(
  () => eventTypes.value.map((item) => item.name).join(", ") || "none registered",
);

const enforceDisabledReason = computed(() =>
  effectiveSchema.value
    ? ""
    : `Schema enforcement is off for ${effectiveType.value || "this type"} — no payload schema`
      + " is registered for this event type yet. Pick a type that has a schema"
      + ` (${registeredNames.value}) or ask your Benji contact to add one for this type.`,
);

const customType = ref("");

const effectiveType = computed(() =>
  eventType.value === "custom" ? customType.value : eventType.value,
);

let timer: number | null = null;

watch(effectiveType, (type) => void refreshMatches(type), { immediate: true });

onMounted(() => {
  void loadEventTypes();
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
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">
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
      <div class="schema-row" :class="{ 'is-disabled': !effectiveSchema }">
        <label class="switch" :class="{ 'is-disabled': !effectiveSchema }" :title="enforceDisabledReason">
          <input
            type="checkbox"
            data-testid="enforce-schema"
            :checked="enforceSchema"
            :disabled="submitting || !effectiveSchema"
            @change="setEnforceSchema(($event.target as HTMLInputElement).checked)"
          />
          Enforce schema
        </label>
        <span v-if="!effectiveSchema && effectiveType" class="attempt-help schema-help">
          <button
            type="button"
            class="attempt-help-trigger"
            aria-label="Why is schema enforcement disabled?"
            data-testid="enforce-schema-help"
          >
            ?
          </button>
          <span class="tip" role="tooltip" data-testid="enforce-schema-tip">
            <strong>Schema enforcement is off for this type</strong>
            <span>
              No payload schema is registered for <code>{{ effectiveType }}</code> yet, so there is
              nothing to check — the event is still published.
            </span>
            <em>
              Pick a type that has a schema ({{ registeredNames }}) or ask your Benji contact to
              add one for this type.
            </em>
          </span>
        </span>
        <span v-if="expectedShape" class="side-note" data-testid="expected-shape">
          expected: {{ expectedShape }}
        </span>
        <span v-else-if="effectiveType" class="side-note" data-testid="no-schema">
          no schema registered for this type yet
        </span>
      </div>
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
      <SimulatedTraffic :api="api" />
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

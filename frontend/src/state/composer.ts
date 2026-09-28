import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, EventTypeInfo } from "../api/client";

export type ComposerOutcome =
  | { kind: "accepted"; eventId: string }
  | { kind: "deduplicated"; eventId: string }
  | { kind: "conflict"; message: string }
  | { kind: "uncertain"; message: string }
  | { kind: "error"; message: string };

export function newSubmissionKey(): string {
  return crypto.randomUUID();
}

export function createComposerState(api: DashboardApi) {
  const eventType = ref("reward_transaction_created");
  const payloadText = ref("{}");
  const submissionKey = ref(newSubmissionKey());
  const keyManuallyEdited = ref(false);
  const submitting = ref(false);
  const outcome = ref<ComposerOutcome | null>(null);
  const matchCount = ref<number | null>(null);
  const eventTypes = ref<EventTypeInfo[]>([]);
  const enforceSchema = ref(true);

  async function loadEventTypes(): Promise<void> {
    try {
      eventTypes.value = (await api.listEventTypes()).items;
    } catch {
      eventTypes.value = [];
    }
  }

  function schemaFor(type: string): EventTypeInfo | null {
    return eventTypes.value.find((item) => item.name === type) ?? null;
  }

  function setEnforceSchema(value: boolean): void {
    enforceSchema.value = value;
  }

  async function refreshMatches(type: string): Promise<void> {
    if (!type) {
      matchCount.value = null;
      return;
    }
    try {
      const response = await api.listEndpoints();
      matchCount.value = response.items.filter(
        (endpoint) => endpoint.enabled && endpoint.event_types.includes(type),
      ).length;
    } catch {
      matchCount.value = null;
    }
  }

  async function submit(typeOverride?: string): Promise<void> {
    if (submitting.value) return;
    const targetType = typeOverride ?? eventType.value;
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText.value);
    } catch {
      outcome.value = { kind: "error", message: "Payload must be valid JSON." };
      return;
    }
    submitting.value = true;
    outcome.value = null;
    try {
      const result = await api.submitEvent({
        idempotency_key: submissionKey.value,
        type: targetType,
        payload,
        enforce_schema: enforceSchema.value && schemaFor(targetType) !== null,
      });
      outcome.value = result.deduplicated
        ? { kind: "deduplicated", eventId: result.event_id }
        : { kind: "accepted", eventId: result.event_id };
      if (!result.deduplicated && !keyManuallyEdited.value) {
        submissionKey.value = newSubmissionKey();
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "idempotency_conflict") {
        outcome.value = { kind: "conflict", message: cause.message };
      } else if (
        cause instanceof ApiError &&
        (cause.httpStatus === null || cause.httpStatus >= 500)
      ) {
        outcome.value = { kind: "uncertain", message: cause.message };
      } else {
        outcome.value = {
          kind: "error",
          message: cause instanceof ApiError ? cause.message : "Unexpected error.",
        };
      }
    } finally {
      submitting.value = false;
    }
  }

  function updateKey(value: string): void {
    submissionKey.value = value;
    keyManuallyEdited.value = true;
  }

  function newKey(): void {
    submissionKey.value = newSubmissionKey();
    keyManuallyEdited.value = false;
    outcome.value = null;
  }

  return {
    eventType,
    payloadText,
    submissionKey,
    keyManuallyEdited,
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
  };
}

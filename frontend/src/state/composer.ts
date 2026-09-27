import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi } from "../api/client";

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
  const submitting = ref(false);
  const outcome = ref<ComposerOutcome | null>(null);
  const matchCount = ref<number | null>(null);

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

  async function submit(): Promise<void> {
    if (submitting.value) return;
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
        type: eventType.value,
        payload,
      });
      outcome.value = result.deduplicated
        ? { kind: "deduplicated", eventId: result.event_id }
        : { kind: "accepted", eventId: result.event_id };
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

  function newKey(): void {
    submissionKey.value = newSubmissionKey();
    outcome.value = null;
  }

  return {
    eventType,
    payloadText,
    submissionKey,
    submitting,
    outcome,
    matchCount,
    refreshMatches,
    submit,
    newKey,
  };
}

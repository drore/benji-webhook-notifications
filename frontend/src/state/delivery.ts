import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, DeliveryDetail, DeliveryStatus } from "../api/client";

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  retrying: "Retrying",
  paused: "Paused",
  succeeded: "Delivered",
  failed: "Failed",
};

export const STATUS_COLORS: Record<DeliveryStatus, string> = {
  pending: "#64748b",
  in_progress: "#2563eb",
  retrying: "#b45309",
  paused: "#7c3aed",
  succeeded: "#15803d",
  failed: "#dc2626",
};

export const STATUS_GLYPHS: Record<DeliveryStatus, string> = {
  pending: "◌",
  in_progress: "↻",
  retrying: "↻",
  paused: "‖",
  succeeded: "✓",
  failed: "✕",
};

export function attemptSummary(outcome: string | null, httpStatus: number | null): string {
  switch (outcome) {
    case "success":
      return `2xx (HTTP ${httpStatus ?? "?"})`;
    case "retryable_http":
      return `Retryable HTTP ${httpStatus ?? "?"}`;
    case "http_error":
      return `HTTP ${httpStatus ?? "?"}`;
    case "timeout":
      return "Timeout — outcome unknown at receiver";
    case "transport_error":
      return "Transport error — outcome unknown at receiver";
    case "interrupted":
      return "Interrupted by sender restart";
    case "policy_error":
      return "Destination policy rejected";
    default:
      return outcome ?? "No outcome recorded";
  }
}

export function attemptExplanation(outcome: string | null, httpStatus: number | null): string {
  switch (outcome) {
    case "success":
      return `The receiver accepted this attempt (HTTP ${httpStatus ?? "2xx"}).`;
    case "retryable_http":
      return httpStatus === 429
        ? "The receiver rate-limited this attempt (HTTP 429). It is retried with exponential backoff."
        : `The receiver returned a server-side error (HTTP ${httpStatus ?? "5xx"}). It is retried with exponential backoff.`;
    case "http_error":
      if (httpStatus !== null && httpStatus >= 300 && httpStatus < 400) {
        return `The receiver redirected (HTTP ${httpStatus}). Redirects are never followed, so this delivery fails without retrying.`;
      }
      if (httpStatus === 401 || httpStatus === 403) {
        return `The receiver rejected the request, likely a signature mismatch (HTTP ${httpStatus}). Client errors fail without retrying.`;
      }
      if (httpStatus === 404) {
        return "The receiver path was not found (HTTP 404). Client errors fail without retrying.";
      }
      return `The receiver rejected the request (HTTP ${httpStatus ?? "4xx"}). Client errors fail without retrying.`;
    case "timeout":
      return "No response within the request timeout — the receiver may or may not have processed it (outcome unknown at receiver). It is retried.";
    case "transport_error":
      return "The connection failed before a response. It is retried with exponential backoff.";
    case "interrupted":
      return "The sender restarted while this attempt was in flight; it counts against this cycle's attempt budget.";
    case "policy_error":
      return "The destination URL failed the local destination policy at dispatch; nothing was sent.";
    default:
      return "No outcome recorded for this attempt.";
  }
}

export function createDeliveryState(api: DashboardApi) {
  const delivery = ref<DeliveryDetail | null>(null);
  const loading = ref(false);
  const stale = ref(false);
  const lastUpdatedAt = ref<Date | null>(null);
  const error = ref<string | null>(null);
  const replaying = ref(false);
  const replayError = ref<string | null>(null);

  async function load(id: string): Promise<void> {
    loading.value = true;
    try {
      delivery.value = await api.getDelivery(id);
      stale.value = false;
      lastUpdatedAt.value = new Date();
      error.value = null;
    } catch (cause) {
      stale.value = true;
      error.value = cause instanceof ApiError ? cause.message : "Could not load the delivery.";
    } finally {
      loading.value = false;
    }
  }

  async function replay(): Promise<boolean> {
    if (!delivery.value || replaying.value) return false;
    replaying.value = true;
    replayError.value = null;
    try {
      await api.replayDelivery(delivery.value.id);
      await load(delivery.value.id);
      return true;
    } catch (cause) {
      replayError.value =
        cause instanceof ApiError ? cause.message : "Could not replay the delivery.";
      return false;
    } finally {
      replaying.value = false;
    }
  }

  return { delivery, loading, stale, lastUpdatedAt, error, replaying, replayError, load, replay };
}

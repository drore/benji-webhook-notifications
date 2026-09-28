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

export interface AttemptExplanation {
  title: string;
  meaning: string;
  consequence: string;
}

export function attemptExplanation(
  outcome: string | null,
  httpStatus: number | null,
): AttemptExplanation {
  switch (outcome) {
    case "success":
      return {
        title: `HTTP ${httpStatus ?? "2xx"} — delivered`,
        meaning: "The receiver accepted this attempt.",
        consequence: "No further attempts; the branch is complete.",
      };
    case "retryable_http":
      return httpStatus === 429
        ? {
            title: "HTTP 429 — rate limited",
            meaning: "The receiver asked the sender to slow down.",
            consequence: "Retried with exponential backoff (2s, then 4s) within this cycle.",
          }
        : {
            title: `HTTP ${httpStatus ?? "5xx"} — receiver error`,
            meaning: "The receiver could not process the request.",
            consequence: "Retried with exponential backoff (2s, then 4s) within this cycle.",
          };
    case "http_error":
      if (httpStatus !== null && httpStatus >= 300 && httpStatus < 400) {
        return {
          title: `HTTP ${httpStatus} — redirect`,
          meaning: "The receiver redirected the request.",
          consequence: "Redirects are never followed; this delivery fails without retrying.",
        };
      }
      if (httpStatus === 401 || httpStatus === 403) {
        return {
          title: `HTTP ${httpStatus} — rejected`,
          meaning: "The receiver likely rejected the signature or credentials.",
          consequence:
            "Client errors fail without retrying — check the secret configured at the receiver.",
        };
      }
      if (httpStatus === 404) {
        return {
          title: "HTTP 404 — path not found",
          meaning: "Nothing is listening at this URL path.",
          consequence: "Client errors fail without retrying.",
        };
      }
      return {
        title: `HTTP ${httpStatus ?? "4xx"} — client error`,
        meaning: "The receiver rejected the request.",
        consequence: "Client errors fail without retrying.",
      };
    case "timeout":
      return {
        title: "Timeout — outcome unknown at receiver",
        meaning: "No response within the 2-second request timeout.",
        consequence:
          "The receiver may or may not have processed it; the attempt is retried and the receiver dedupes by delivery ID.",
      };
    case "transport_error":
      return {
        title: "Transport error — outcome unknown at receiver",
        meaning: "The connection failed before a response arrived.",
        consequence: "Retried with exponential backoff.",
      };
    case "interrupted":
      return {
        title: "Interrupted",
        meaning: "The sender restarted while this attempt was in flight.",
        consequence:
          "Counts against this cycle's attempt budget; the delivery resumes if budget remains.",
      };
    case "policy_error":
      return {
        title: "Destination policy rejected",
        meaning: "The destination URL failed the local destination policy at dispatch.",
        consequence: "Nothing was sent; this delivery fails.",
      };
    default:
      return {
        title: "No outcome recorded",
        meaning: "This attempt has no stored result.",
        consequence: "—",
      };
  }
}

export function attemptProgress(
  status: DeliveryStatus,
  cycleAttempts: number,
  attemptsCount: number,
  dueAt: string | null,
  now = Date.now(),
): string {
  switch (status) {
    case "pending":
      return "waiting for the first attempt";
    case "in_progress":
      return `attempt ${cycleAttempts + 1} of 3 in flight`;
    case "retrying": {
      const seconds = dueAt ? Math.round((new Date(dueAt).getTime() - now) / 1000) : null;
      const when = seconds === null ? "scheduled" : seconds <= 0 ? "due now" : `next attempt in ${seconds}s`;
      return `attempt ${cycleAttempts + 1} of 3 · ${when}`;
    }
    case "paused":
      return `paused with ${cycleAttempts} of 3 attempts used this cycle`;
    case "succeeded":
      return `delivered on attempt ${Math.max(attemptsCount, 1)}`;
    case "failed":
      return cycleAttempts === attemptsCount
        ? `failed after ${cycleAttempts} of 3 attempts`
        : `failed after ${cycleAttempts} of 3 this cycle · ${attemptsCount} attempts overall`;
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

  function reset(): void {
    delivery.value = null;
    loading.value = false;
    stale.value = false;
    lastUpdatedAt.value = null;
    error.value = null;
    replaying.value = false;
    replayError.value = null;
  }

  return {
    delivery,
    loading,
    stale,
    lastUpdatedAt,
    error,
    replaying,
    replayError,
    load,
    replay,
    reset,
  };
}

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

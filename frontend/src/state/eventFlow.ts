import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, EventDetail } from "../api/client";
import { POLL_INTERVAL_MS, shouldPoll } from "./live";

/**
 * The journey's data and actions. The component keeps only presentation
 * (Vue Flow nodes, edges, fit-to-view); everything that talks to the API or
 * decides what a failed branch is lives here.
 */
export function createEventFlowState(api: DashboardApi) {
  const event = ref<EventDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdatedAt = ref<Date | null>(null);
  const replayingAll = ref(false);
  const replaySummary = ref<string | null>(null);
  let timer: number | null = null;

  async function load(eventId: string | null): Promise<void> {
    if (!eventId) {
      event.value = null;
      return;
    }
    loading.value = true;
    try {
      event.value = await api.getEvent(eventId);
      lastUpdatedAt.value = new Date();
      error.value = null;
    } catch (cause) {
      error.value =
        cause instanceof ApiError ? cause.message : "Could not load the selected event.";
    } finally {
      loading.value = false;
    }
  }

  function failedDeliveries(): EventDetail["deliveries"] {
    return (event.value?.deliveries ?? []).filter((delivery) => delivery.status === "failed");
  }

  async function replayFailed(): Promise<void> {
    const targets = failedDeliveries();
    if (replayingAll.value || !targets.length) return;
    replayingAll.value = true;
    replaySummary.value = null;
    let replayed = 0;
    const blocked: string[] = [];
    for (const delivery of targets) {
      try {
        await api.replayDelivery(delivery.id);
        replayed += 1;
      } catch {
        blocked.push(delivery.endpoint_name);
      }
    }
    replaySummary.value = blocked.length
      ? `Replayed ${replayed} of ${targets.length}; ${blocked.length} could not start (${blocked.join(
          ", ",
        )}) — a disabled endpoint blocks replay until it is resumed.`
      : `Replayed ${replayed} of ${targets.length} failed deliveries — attempts append to the same delivery.`;
    replayingAll.value = false;
    await load(event.value?.id ?? null);
  }

  function startPolling(
    getEventId: () => string | null,
    intervalMs = POLL_INTERVAL_MS,
  ): void {
    stopPolling();
    timer = window.setInterval(() => {
      if (shouldPoll()) void load(getEventId());
    }, intervalMs);
  }

  function stopPolling(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return {
    event,
    loading,
    error,
    lastUpdatedAt,
    replayingAll,
    replaySummary,
    failedDeliveries,
    load,
    replayFailed,
    startPolling,
    stopPolling,
  };
}

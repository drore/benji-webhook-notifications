import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, EventSummary } from "../api/client";

const DEFAULT_POLL_MS = 2000;

export function createEventsState(api: DashboardApi) {
  const events = ref<EventSummary[]>([]);
  const loading = ref(false);
  const stale = ref(false);
  const lastUpdatedAt = ref<Date | null>(null);
  const error = ref<string | null>(null);
  let timer: number | null = null;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const response = await api.listEvents(50);
      events.value = response.items;
      stale.value = false;
      lastUpdatedAt.value = new Date();
      error.value = null;
    } catch (cause) {
      stale.value = true;
      error.value = cause instanceof ApiError ? cause.message : "Could not load events.";
    } finally {
      loading.value = false;
    }
  }

  function startPolling(intervalMs = DEFAULT_POLL_MS): void {
    stopPolling();
    void load();
    timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
  }

  function stopPolling(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return { events, loading, stale, lastUpdatedAt, error, load, startPolling, stopPolling };
}

import { ref, watch } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, EventListParams, EventSummary } from "../api/client";
import { eventFilters } from "./filters";
import { refreshToken, shouldPoll } from "./live";

const DEFAULT_POLL_MS = 2000;
const PAGE_SIZE = 50;

export function createEventsState(api: DashboardApi) {
  const events = ref<EventSummary[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const loadingMore = ref(false);
  const stale = ref(false);
  const lastUpdatedAt = ref<Date | null>(null);
  const error = ref<string | null>(null);
  let timer: number | null = null;

  function params(offset: number, limit: number): EventListParams {
    return {
      limit,
      ...(offset ? { offset } : {}),
      ...(eventFilters.status !== "all" ? { status: eventFilters.status } : {}),
      ...(eventFilters.type ? { type: eventFilters.type } : {}),
      ...(eventFilters.endpointId ? { endpoint_id: eventFilters.endpointId } : {}),
    };
  }

  async function load(offset = 0): Promise<void> {
    // Refreshing keeps the pages the operator already expanded in view.
    const limit = offset === 0 ? Math.max(PAGE_SIZE, events.value.length) : PAGE_SIZE;
    if (offset === 0) loading.value = true;
    else loadingMore.value = true;
    try {
      const response = await api.listEvents(params(offset, limit));
      events.value = offset === 0 ? response.items : [...events.value, ...response.items];
      total.value = response.total;
      stale.value = false;
      lastUpdatedAt.value = new Date();
      error.value = null;
    } catch (cause) {
      stale.value = true;
      error.value = cause instanceof ApiError ? cause.message : "Could not load events.";
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  }

  function loadMore(): void {
    if (loading.value || loadingMore.value || events.value.length >= total.value) return;
    void load(events.value.length);
  }

  watch(
    () => [eventFilters.status, eventFilters.type, eventFilters.endpointId].join("|"),
    () => {
      void load(0);
    },
  );
  watch(refreshToken, () => void load(0));

  function startPolling(intervalMs = DEFAULT_POLL_MS): void {
    stopPolling();
    void load(0);
    timer = window.setInterval(() => {
      if (shouldPoll()) void load(0);
    }, intervalMs);
  }

  function stopPolling(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return {
    events,
    total,
    loading,
    loadingMore,
    stale,
    lastUpdatedAt,
    error,
    load,
    loadMore,
    startPolling,
    stopPolling,
  };
}

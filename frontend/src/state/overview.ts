import { ref, watch } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, Overview } from "../api/client";
import { POLL_INTERVAL_MS, refreshToken, shouldPoll } from "./live";

export function createOverviewState(api: DashboardApi) {
  const overview = ref<Overview | null>(null);
  const loading = ref(false);
  const stale = ref(false);
  const lastUpdatedAt = ref<Date | null>(null);
  const error = ref<string | null>(null);
  let timer: number | null = null;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      overview.value = await api.getOverview();
      stale.value = false;
      lastUpdatedAt.value = new Date();
      error.value = null;
    } catch (cause) {
      stale.value = true;
      error.value = cause instanceof ApiError ? cause.message : "Could not load status.";
    } finally {
      loading.value = false;
    }
  }

  function startPolling(intervalMs = POLL_INTERVAL_MS): void {
    stopPolling();
    void load();
    timer = window.setInterval(() => {
      if (shouldPoll()) void load();
    }, intervalMs);
  }

  watch(refreshToken, () => void load());

  function stopPolling(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return { overview, loading, stale, lastUpdatedAt, error, load, startPolling, stopPolling };
}

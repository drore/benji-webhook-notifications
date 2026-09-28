import { ref, watch } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, EventTypeInfo, EventTypeStats } from "../api/client";

const DEFAULT_POLL_MS = 10000;

export const TREND_WINDOWS = [
  { value: 6, label: "Last 6 hours", buckets: 12 },
  { value: 24, label: "Last 24 hours", buckets: 24 },
  { value: 168, label: "Last 7 days", buckets: 28 },
];

export function bucketsForWindow(hours: number): number {
  return TREND_WINDOWS.find((window) => window.value === hours)?.buckets ?? 24;
}

export function createTrendState(api: DashboardApi) {
  const types = ref<EventTypeInfo[]>([]);
  const eventType = ref("reward_transaction_created");
  const hours = ref(24);
  const stats = ref<EventTypeStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let timer: number | null = null;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      stats.value = await api.getEventTypeStats(eventType.value, {
        hours: hours.value,
        buckets: bucketsForWindow(hours.value),
      });
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause.message : "Could not load the trend.";
    } finally {
      loading.value = false;
    }
  }

  async function loadTypes(): Promise<void> {
    try {
      const registered = (await api.listEventTypes()).items;
      // Types with recent traffic are trendable even without a payload schema.
      let seen: string[] = [];
      try {
        const events = await api.listEvents({ limit: 50 });
        seen = [...new Set(events.items.map((event) => event.type))];
      } catch {
        seen = [];
      }
      const names = new Set(registered.map((item) => item.name));
      types.value = [
        ...registered,
        ...seen
          .filter((name) => !names.has(name))
          .map((name) => ({ name, description: "recent traffic", schema: {} })),
      ];
      if (types.value.length && !types.value.some((item) => item.name === eventType.value)) {
        eventType.value = types.value[0].name;
      }
    } catch {
      types.value = [];
    }
  }

  watch([eventType, hours], () => void load());

  function startPolling(intervalMs = DEFAULT_POLL_MS): void {
    stopPolling();
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

  return {
    types,
    eventType,
    hours,
    stats,
    loading,
    error,
    load,
    loadTypes,
    startPolling,
    stopPolling,
  };
}

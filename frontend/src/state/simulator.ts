import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi } from "../api/client";

export const SIMULATOR_INTERVALS = [2000, 5000, 10000];
const DEFAULT_INTERVAL_MS = 5000;

/** Payloads that satisfy the registered schema for the busy demo types. */
export function payloadFor(eventType: string, sequence: number): Record<string, unknown> {
  if (eventType === "reward_transaction_created") {
    return { member: `m_sim_${sequence}`, points: (sequence % 9) * 10 };
  }
  if (eventType === "member_account_linked") {
    return { member: `m_sim_${sequence}` };
  }
  return { simulated: true, sequence };
}

/**
 * Publishes events on a timer through the ordinary intake path, so a demo can
 * show real traffic without a second terminal. It is a client of the public
 * API — nothing bypasses validation, deduplication, or the delivery worker.
 */
export function createSimulatorState(api: DashboardApi) {
  const running = ref(false);
  const intervalMs = ref(DEFAULT_INTERVAL_MS);
  const eventType = ref("");
  const availableTypes = ref<string[]>([]);
  const published = ref(0);
  const error = ref<string | null>(null);
  let timer: number | null = null;
  let sequence = 0;

  async function loadTypes(): Promise<void> {
    const names = new Set<string>();
    try {
      for (const item of (await api.listEventTypes()).items) names.add(item.name);
    } catch {
      // The registry is optional; subscribers alone are enough to pick a type.
    }
    try {
      for (const endpoint of (await api.listEndpoints()).items) {
        if (!endpoint.enabled) continue;
        for (const type of endpoint.event_types) names.add(type);
      }
    } catch {
      // Ignore: the select keeps whatever it already had.
    }
    availableTypes.value = [...names].sort();
    if (!eventType.value || !availableTypes.value.includes(eventType.value)) {
      eventType.value = availableTypes.value[0] ?? "reward_transaction_created";
    }
  }

  async function publishOnce(): Promise<void> {
    sequence += 1;
    try {
      await api.submitEvent({
        idempotency_key: crypto.randomUUID(),
        type: eventType.value,
        payload: payloadFor(eventType.value, sequence),
        enforce_schema: true,
      });
      published.value += 1;
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause.message : "Simulated publish failed.";
      stop();
    }
  }

  function start(): void {
    if (running.value || !eventType.value) return;
    running.value = true;
    error.value = null;
    void publishOnce();
    timer = window.setInterval(() => {
      if (!document.hidden) void publishOnce();
    }, intervalMs.value);
  }

  function stop(): void {
    running.value = false;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function toggle(): void {
    if (running.value) stop();
    else start();
  }

  function setIntervalMs(value: number): void {
    intervalMs.value = value;
    if (running.value) {
      stop();
      start();
    }
  }

  return {
    running,
    intervalMs,
    eventType,
    availableTypes,
    published,
    error,
    loadTypes,
    start,
    stop,
    toggle,
    setIntervalMs,
  };
}

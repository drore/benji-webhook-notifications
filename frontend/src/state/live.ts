import { ref } from "vue";

/**
 * One place that decides whether the dashboard is fetching. Panels keep their
 * own timers, but they all ask this module, so "pause live updates" really
 * pauses everything and "refresh now" really refreshes everything.
 */
export const frozen = ref(false);
export const refreshToken = ref(0);
export const now = ref(Date.now());

/** FR-10: the dashboard refreshes every two seconds while the tab is visible. */
export const POLL_INTERVAL_MS = 2000;
export const TREND_POLL_INTERVAL_MS = 10000;

let clock: number | null = null;

export function setFrozen(value: boolean): void {
  frozen.value = value;
}

export function toggleFrozen(): void {
  frozen.value = !frozen.value;
}

export function requestRefresh(): void {
  refreshToken.value += 1;
}

export function shouldPoll(): boolean {
  return !frozen.value && !document.hidden;
}

export function startClock(): void {
  if (clock !== null) return;
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
}

export function stopClock(): void {
  if (clock === null) return;
  window.clearInterval(clock);
  clock = null;
}

/** "updated 12s ago" for a panel that last loaded at the given time. */
export function updatedLabel(lastUpdatedAt: Date | null, nowMs = now.value): string {
  if (!lastUpdatedAt) return "waiting for data";
  const seconds = Math.max(0, Math.round((nowMs - lastUpdatedAt.getTime()) / 1000));
  if (seconds < 2) return "updated just now";
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  return `updated ${Math.round(minutes / 60)}h ago`;
}

/**
 * Panel header text. A healthy panel just says "live" so the label does not
 * flicker on every poll; a panel that falls behind its own interval, or a
 * frozen dashboard, states the age.
 */
export function freshnessLabel(
  lastUpdatedAt: Date | null,
  isFrozen: boolean,
  nowMs = now.value,
  intervalMs = POLL_INTERVAL_MS,
): string {
  if (isFrozen) {
    return lastUpdatedAt ? `paused · ${updatedLabel(lastUpdatedAt, nowMs)}` : "paused";
  }
  if (!lastUpdatedAt) return "live";
  const grace = Math.max(1000, intervalMs) * 2;
  if (nowMs - lastUpdatedAt.getTime() < grace) return "live";
  return `live · ${updatedLabel(lastUpdatedAt, nowMs)}`;
}

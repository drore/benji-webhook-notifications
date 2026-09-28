import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboardApi } from "../src/api/client";
import type { DashboardApi } from "../src/api/client";
import { createEventsState } from "../src/state/events";
import {
  frozen,
  refreshToken,
  requestRefresh,
  setFrozen,
  shouldPoll,
  updatedLabel,
} from "../src/state/live";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setFrozen(false);
});

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    ...createDashboardApi(),
    listEndpoints: async () => ({ items: [] }),
    listEvents: async () => ({ items: [], total: 0 }),
    ...overrides,
  } as DashboardApi;
}

describe("live updates", () => {
  it("polls only while not frozen and visible", () => {
    expect(shouldPoll()).toBe(true);
    setFrozen(true);
    expect(shouldPoll()).toBe(false);
    setFrozen(false);
    expect(shouldPoll()).toBe(true);
  });

  it("describes how fresh the data is", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(updatedLabel(null, now.getTime())).toBe("waiting for data");
    expect(updatedLabel(new Date(now.getTime() - 500), now.getTime())).toBe("updated just now");
    expect(updatedLabel(new Date(now.getTime() - 12_000), now.getTime())).toBe("updated 12s ago");
    expect(updatedLabel(new Date(now.getTime() - 180_000), now.getTime())).toBe("updated 3m ago");
    expect(updatedLabel(new Date(now.getTime() - 7_200_000), now.getTime())).toBe("updated 2h ago");
  });

  it("bumps the refresh token on demand", () => {
    const before = refreshToken.value;
    requestRefresh();
    expect(refreshToken.value).toBe(before + 1);
  });

  it("stops polling while frozen and catches up on refresh", async () => {
    vi.useFakeTimers();
    const listEvents = vi.fn(async () => ({ items: [], total: 0 }));
    const api = fakeApi({ listEvents: listEvents as unknown as DashboardApi["listEvents"] });
    const state = createEventsState(api);

    state.startPolling(1000);
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = listEvents.mock.calls.length;
    expect(afterStart).toBeGreaterThan(0);

    setFrozen(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(listEvents.mock.calls.length).toBe(afterStart);

    setFrozen(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listEvents.mock.calls.length).toBeGreaterThan(afterStart);

    const beforeRefresh = listEvents.mock.calls.length;
    requestRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(listEvents.mock.calls.length).toBe(beforeRefresh + 1);
    expect(frozen.value).toBe(false);

    state.stopPolling();
  });
});

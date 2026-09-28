import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppHeader from "../src/components/AppHeader.vue";
import EventsList from "../src/components/EventsList.vue";
import { ApiError, createDashboardApi } from "../src/api/client";
import type { DashboardApi } from "../src/api/client";
import { createOverviewState } from "../src/state/overview";

afterEach(() => vi.restoreAllMocks());

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return { ...createDashboardApi(), ...overrides };
}

describe("polling and staleness", () => {
  it("marks status stale on polling failure and recovers", async () => {
    vi.useFakeTimers();
    let failing = true;
    const api = fakeApi({
      getOverview: async () =>
        failing
          ? Promise.reject(new ApiError("transport_error", "down", null))
          : { failed_count: 0, retrying_count: 0, earliest_due_at: null, latest_event: null },
      listEvents: async () => ({ items: [], total: 0 }),
    });
    const overview = createOverviewState(api);
    overview.startPolling(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(overview.stale.value).toBe(true);
    failing = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(overview.stale.value).toBe(false);
    expect(overview.lastUpdatedAt.value).not.toBeNull();
    overview.stopPolling();
    vi.useRealTimers();
  });

  it("header shows failed and retrying counts plus a stale banner", async () => {
    const api = fakeApi({
      getOverview: vi.fn(async () => ({
        failed_count: 2,
        retrying_count: 1,
        earliest_due_at: "2026-09-27T12:00:04Z",
        latest_event: null,
      })),
    });
    const wrapper = mount(AppHeader, { props: { api } });
    await flushPromises();
    expect(wrapper.text()).toContain("Needs attention");
    expect(wrapper.get('[data-testid="failed-count"]').text()).toBe("2");
    expect(wrapper.get('[data-testid="retrying-count"]').text()).toBe("1");
  });

  it("events list emits the selected event id", async () => {
    const api = fakeApi({
      listEvents: async () => ({
        items: [
          {
            id: "evt_1",
            type: "reward_transaction_created",
            created_at: "2026-09-27T12:00:00Z",
            deliveries: {
              pending: 1,
              in_progress: 0,
              retrying: 0,
              paused: 0,
              succeeded: 0,
              failed: 0,
            },
          },
        ],
        total: 1,
      }),
    });
    const wrapper = mount(EventsList, { props: { api, selectedEventId: null } });
    await flushPromises();
    const row = wrapper.get('[data-testid="event-row"]');
    expect(row.text()).toContain("reward_transaction_created");
    await row.trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["evt_1"]);
  });

  it("marks events with no receivers", async () => {
    const api = fakeApi({
      listEvents: async () => ({
        items: [
          {
            id: "evt_empty",
            type: "campaign_updated",
            created_at: "2026-09-27T12:00:00Z",
            deliveries: {
              pending: 0,
              in_progress: 0,
              retrying: 0,
              paused: 0,
              succeeded: 0,
              failed: 0,
            },
          },
        ],
        total: 1,
      }),
    });
    const wrapper = mount(EventsList, { props: { api, selectedEventId: null } });
    await flushPromises();
    expect(wrapper.get('[data-testid="no-receivers-chip"]').text()).toContain("no receivers");
  });
});

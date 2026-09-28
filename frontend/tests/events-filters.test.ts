import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppHeader from "../src/components/AppHeader.vue";
import EventsList from "../src/components/EventsList.vue";
import { createDashboardApi } from "../src/api/client";
import type { DashboardApi, EventSummary } from "../src/api/client";
import { eventFilters, resetEventFilters, setStatusFilter } from "../src/state/filters";

afterEach(() => {
  vi.restoreAllMocks();
  resetEventFilters();
});

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    ...createDashboardApi(),
    listEndpoints: async () => ({ items: [] }),
    ...overrides,
  };
}

function summary(id: string): EventSummary {
  return {
    id,
    type: "reward_transaction_created",
    created_at: "2026-09-28T09:00:00Z",
    deliveries: {
      pending: 0,
      in_progress: 0,
      retrying: 0,
      paused: 0,
      succeeded: 0,
      failed: 1,
    },
  };
}

describe("event filters and pagination", () => {
  it("requests the active filter and reports how many events match", async () => {
    const listEvents = vi.fn(async () => ({ items: [summary("evt_1")], total: 7 }));
    const api = fakeApi({ listEvents: listEvents as unknown as DashboardApi["listEvents"] });
    setStatusFilter("failed");

    const wrapper = mount(EventsList, { props: { api, selectedEventId: null } });
    await flushPromises();

    expect(listEvents).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(wrapper.text()).toContain("showing 1 of 7");
    expect(wrapper.get('[data-action="clear-filters"]')).toBeTruthy();
  });

  it("appends the next page when more events match", async () => {
    const listEvents = vi.fn(async (params?: { offset?: number }) => ({
      items: [summary(`evt_${params?.offset ?? 0}`)],
      total: 3,
    }));
    const api = fakeApi({ listEvents: listEvents as unknown as DashboardApi["listEvents"] });

    const wrapper = mount(EventsList, { props: { api, selectedEventId: null } });
    await flushPromises();
    await wrapper.get('[data-action="load-more"]').trigger("click");
    await flushPromises();

    expect(listEvents).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }));
    expect(wrapper.findAll('[data-testid="event-row"]')).toHaveLength(2);
  });

  it("explains an empty filtered list and clears the filter on request", async () => {
    const api = fakeApi({ listEvents: async () => ({ items: [], total: 0 }) });
    setStatusFilter("failed");

    const wrapper = mount(EventsList, { props: { api, selectedEventId: null } });
    await flushPromises();
    expect(wrapper.text()).toContain("No events match the current filter");

    await wrapper.get('[data-action="clear-filters"]').trigger("click");
    await flushPromises();
    expect(eventFilters.status).toBe("all");
  });

  it("lets the header signals drive the filter", async () => {
    const api = fakeApi({
      getOverview: async () => ({
        failed_count: 2,
        retrying_count: 1,
        earliest_due_at: null,
        latest_event: null,
      }),
    });
    const wrapper = mount(AppHeader, { props: { api } });
    await flushPromises();

    await wrapper.get('[data-testid="failed-signal"]').trigger("click");
    expect(eventFilters.status).toBe("failed");
    await wrapper.get('[data-testid="retrying-signal"]').trigger("click");
    expect(eventFilters.status).toBe("retrying");
  });
});

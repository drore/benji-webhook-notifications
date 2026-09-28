import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeliveryTrend from "../src/components/DeliveryTrend.vue";
import { createDashboardApi } from "../src/api/client";
import type { DashboardApi, EventTypeStats } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

const STATS: EventTypeStats = {
  type: "reward_transaction_created",
  hours: 24,
  bucket_seconds: 3600,
  window_start: "2026-09-28T00:00:00Z",
  totals: {
    events: 2,
    deliveries: 4,
    pending: 0,
    in_progress: 0,
    retrying: 0,
    paused: 0,
    succeeded: 3,
    failed: 1,
  },
  success_rate: 0.75,
  avg_attempts_per_delivery: 1.5,
  avg_attempt_ms: 42.5,
  buckets: [
    {
      start: "2026-09-28T08:00:00Z",
      events: 1,
      deliveries: 2,
      pending: 0,
      in_progress: 0,
      retrying: 0,
      paused: 0,
      succeeded: 2,
      failed: 0,
    },
    {
      start: "2026-09-28T09:00:00Z",
      events: 1,
      deliveries: 2,
      pending: 0,
      in_progress: 0,
      retrying: 0,
      paused: 0,
      succeeded: 1,
      failed: 1,
    },
  ],
};

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    ...createDashboardApi(),
    listEventTypes: async () => ({
      items: [
        { name: "reward_transaction_created", description: "Reward", schema: {} },
        { name: "member_account_linked", description: "Member", schema: {} },
      ],
    }),
    getEventTypeStats: async () => STATS,
    ...overrides,
  } as DashboardApi;
}

describe("DeliveryTrend", () => {
  it("summarises the window and draws one bar per bucket", async () => {
    const api = fakeApi();
    const wrapper = mount(DeliveryTrend, { props: { api } });
    await flushPromises();

    expect(wrapper.get('[data-testid="trend-deliveries"]').text()).toContain("4 deliveries");
    expect(wrapper.get('[data-testid="trend-success"]').text()).toContain("75%");
    expect(wrapper.text()).toContain("1 failed");
    expect(wrapper.text()).toContain("1.5 attempts per delivery");
    expect(wrapper.text()).toContain("42.5 ms per attempt");
    expect(wrapper.findAll('[data-testid="trend-bar"]')).toHaveLength(2);
  });

  it("reloads with the chosen window", async () => {
    const getEventTypeStats = vi.fn(async () => STATS);
    const api = fakeApi({
      getEventTypeStats: getEventTypeStats as unknown as DashboardApi["getEventTypeStats"],
    });
    const wrapper = mount(DeliveryTrend, { props: { api } });
    await flushPromises();

    await wrapper.get('[aria-label="Trend window"]').setValue("6");
    await flushPromises();

    expect(getEventTypeStats).toHaveBeenCalledWith("reward_transaction_created", {
      hours: 6,
      buckets: 12,
    });
  });

  it("explains an empty window", async () => {
    const api = fakeApi({
      getEventTypeStats: async () => ({
        ...STATS,
        totals: { ...STATS.totals, deliveries: 0, succeeded: 0, failed: 0 },
        success_rate: 0,
        avg_attempts_per_delivery: null,
        avg_attempt_ms: null,
        buckets: STATS.buckets.map((bucket) => ({
          ...bucket,
          deliveries: 0,
          succeeded: 0,
          failed: 0,
        })),
      }),
    });
    const wrapper = mount(DeliveryTrend, { props: { api } });
    await flushPromises();
    expect(wrapper.get('[data-testid="trend-empty"]').text()).toContain("No deliveries");
    expect(wrapper.find('[data-testid="trend-chart"]').exists()).toBe(false);
  });

  it("shows a loading state before the first stats arrive", async () => {
    const api = fakeApi({
      getEventTypeStats: (() => new Promise(() => {})) as unknown as DashboardApi["getEventTypeStats"],
    });
    const wrapper = mount(DeliveryTrend, { props: { api } });
    await flushPromises();
    expect(wrapper.get('[data-testid="trend-loading"]').text()).toContain("Loading trend");
    wrapper.unmount();
  });
});

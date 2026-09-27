import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeliveryPanel from "../src/components/DeliveryPanel.vue";
import EventFlow from "../src/components/EventFlow.vue";
import { createDashboardApi } from "../src/api/client";
import type { DashboardApi, DeliveryDetail } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return { ...createDashboardApi(), ...overrides };
}

const deliveryFixture: DeliveryDetail = {
  id: "dlv_1",
  event_id: "evt_1",
  event: {
    id: "evt_1",
    type: "reward_transaction_created",
    payload: { amount: 5 },
    created_at: "2026-09-27T12:00:00Z",
  },
  endpoint: {
    id: "ep_1",
    name: "Partner CRM",
    url: "http://127.0.0.1:9000/webhooks/crm",
    enabled: true,
  },
  status: "failed",
  due_at: null,
  cycle_attempts: 3,
  attempts: [
    {
      id: 1,
      number: 1,
      started_at: "2026-09-27T12:00:00Z",
      finished_at: "2026-09-27T12:00:02Z",
      outcome: "timeout",
      http_status: null,
      response_excerpt: null,
    },
  ],
};

describe("EventFlow and DeliveryPanel", () => {
  it("renders one branch per delivery with status text and icon", async () => {
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_1",
        type: "reward_transaction_created",
        payload: { amount: 5 },
        created_at: "2026-09-27T12:00:00Z",
        deliveries: [
          {
            id: "dlv_1",
            endpoint_id: "ep_1",
            endpoint_name: "Partner CRM",
            endpoint_url: "http://127.0.0.1:9000/webhooks/crm",
            status: "succeeded",
            due_at: null,
            attempts_count: 1,
          },
          {
            id: "dlv_2",
            endpoint_id: "ep_2",
            endpoint_name: "Rewards ledger",
            endpoint_url: "http://127.0.0.1:9000/webhooks/ledger",
            status: "retrying",
            due_at: "2026-09-27T12:00:04Z",
            attempts_count: 1,
          },
        ],
      }),
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_1" } });
    await flushPromises();
    const branches = wrapper.findAll('[data-testid="branch"]');
    expect(branches).toHaveLength(2);
    expect(branches[0].attributes("data-status")).toBe("succeeded");
    expect(branches[0].text()).toContain("Partner CRM");
    expect(branches[1].attributes("data-status")).toBe("retrying");
    expect(branches[1].text()).toContain("Retrying");
    await branches[0].trigger("click");
    expect((wrapper.emitted("select-delivery") ?? [])[0]).toEqual(["dlv_1"]);
  });

  it("shows no-receivers explanation for an empty event", async () => {
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_2",
        type: "campaign_updated",
        payload: {},
        created_at: "2026-09-27T12:00:00Z",
        deliveries: [],
      }),
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_2" } });
    await flushPromises();
    expect(wrapper.get('[data-testid="no-receivers"]').text()).toContain("No receivers matched");
  });

  it("offers replay only for failed deliveries and disables it while pending", async () => {
    const replayDelivery = vi.fn(async () => ({ delivery_id: "dlv_1", status: "pending" }));
    const api = fakeApi({
      getDelivery: async () => deliveryFixture,
      replayDelivery: replayDelivery as DashboardApi["replayDelivery"],
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    const button = wrapper.get('button[data-action="replay"]');
    await button.trigger("click");
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
    await flushPromises();
    expect(replayDelivery).toHaveBeenCalledWith("dlv_1");
  });

  it("labels timeout attempts outcome-unknown", async () => {
    const api = fakeApi({ getDelivery: async () => deliveryFixture });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    const attempt = wrapper.get('[data-testid="attempt-row"]');
    expect(attempt.text()).toContain("Timeout");
    expect(attempt.text().toLowerCase()).toContain("outcome unknown");
  });

  it("explains each attempt outcome in context", async () => {
    const stamp = "2026-09-27T12:00:00Z";
    const api = fakeApi({
      getDelivery: async () => ({
        ...deliveryFixture,
        attempts: [
          {
            id: 1,
            number: 1,
            started_at: stamp,
            finished_at: stamp,
            outcome: "retryable_http",
            http_status: 500,
            response_excerpt: null,
          },
          {
            id: 2,
            number: 2,
            started_at: stamp,
            finished_at: stamp,
            outcome: "http_error",
            http_status: 404,
            response_excerpt: null,
          },
          {
            id: 3,
            number: 3,
            started_at: stamp,
            finished_at: stamp,
            outcome: "timeout",
            http_status: null,
            response_excerpt: null,
          },
        ],
      }),
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    expect(wrapper.findAll('[data-testid="attempt-help"]')).toHaveLength(3);
    const tips = wrapper.findAll('[role="tooltip"]').map((tip) => tip.text());
    expect(tips[0]).toContain("backoff");
    expect(tips[1]).toContain("not found");
    expect(tips[1]).toContain("without retrying");
    expect(tips[2]).toContain("outcome unknown at receiver");
  });

  it("polls the selected event so branch status updates without manual refresh", async () => {
    vi.useFakeTimers();
    let status: "retrying" | "succeeded" = "retrying";
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_1",
        type: "reward_transaction_created",
        payload: { amount: 5 },
        created_at: "2026-09-27T12:00:00Z",
        deliveries: [
          {
            id: "dlv_1",
            endpoint_id: "ep_1",
            endpoint_name: "Partner CRM",
            endpoint_url: "http://127.0.0.1:9000/webhooks/crm",
            status,
            due_at: null,
            attempts_count: 1,
          },
        ],
      }),
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_1" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.get('[data-testid="branch"]').text()).toContain("Retrying");
    status = "succeeded";
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.get('[data-testid="branch"]').text()).toContain("Delivered");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("shows replay-unavailable text when the endpoint is disabled", async () => {
    const api = fakeApi({
      getDelivery: async () => ({
        ...deliveryFixture,
        endpoint: { ...deliveryFixture.endpoint, enabled: false },
      }),
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    expect(wrapper.find('button[data-action="replay"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="replay-unavailable"]').text()).toContain("disabled");
  });
});

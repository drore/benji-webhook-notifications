import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeliveryPanel from "../src/components/DeliveryPanel.vue";
import EventFlow from "../src/components/EventFlow.vue";
import { createDashboardApi } from "../src/api/client";
import type { DashboardApi, DeliveryDetail } from "../src/api/client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  claim_started_at: null,
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
            cycle_attempts: 1,
            last_outcome: "success",
            last_http_status: 200,
          },
          {
            id: "dlv_2",
            endpoint_id: "ep_2",
            endpoint_name: "Rewards ledger",
            endpoint_url: "http://127.0.0.1:9000/webhooks/ledger",
            status: "retrying",
            due_at: "2026-09-27T12:00:04Z",
            attempts_count: 1,
            cycle_attempts: 1,
            last_outcome: "retryable_http",
            last_http_status: 500,
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
    expect(branches[1].get('[role="tooltip"]').text()).toContain("backoff");
    await branches[0].trigger("click");
    expect((wrapper.emitted("select-delivery") ?? [])[0]).toEqual(["dlv_1"]);
  });

  it("shows the last HTTP outcome with an explanation on the journey node", async () => {
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_1",
        type: "reward_transaction_created",
        payload: {},
        created_at: "2026-09-27T12:00:00Z",
        deliveries: [
          {
            id: "dlv_1",
            endpoint_id: "ep_1",
            endpoint_name: "Partner CRM",
            endpoint_url: "http://127.0.0.1:9000/webhooks/crm",
            status: "failed",
            due_at: null,
            attempts_count: 1,
            cycle_attempts: 1,
            last_outcome: "http_error",
            last_http_status: 404,
          },
        ],
      }),
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_1" } });
    await flushPromises();
    const branch = wrapper.get('[data-testid="branch"]');
    expect(branch.text()).toContain("Failed");
    expect(branch.text()).toContain("failed after 1 of 3 attempts");
    expect(branch.text()).toContain("Last: HTTP 404");
    expect(branch.get('[role="tooltip"]').text()).toContain("not found");
  });

  it("reports attempt progress per cycle, not the lifetime attempt count", async () => {
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_1",
        type: "reward_transaction_created",
        payload: {},
        created_at: "2026-09-27T12:00:00Z",
        deliveries: [
          {
            id: "dlv_1",
            endpoint_id: "ep_1",
            endpoint_name: "Partner CRM",
            endpoint_url: "http://127.0.0.1:9000/webhooks/crm",
            status: "failed",
            due_at: null,
            attempts_count: 6, // one replay: three attempts in each of two cycles
            cycle_attempts: 3,
            last_outcome: "retryable_http",
            last_http_status: 500,
          },
        ],
      }),
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_1" } });
    await flushPromises();
    const branch = wrapper.get('[data-testid="branch"]');
    expect(branch.text()).toContain("failed after 3 of 3 this cycle");
    expect(branch.text()).toContain("6 attempts overall");
    expect(branch.text()).not.toContain("6 of 3");
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

  it("shows the next scheduled attempt on the timeline", async () => {
    const stamp = "2026-09-27T12:00:00Z";
    const api = fakeApi({
      getDelivery: async () => ({
        ...deliveryFixture,
        status: "retrying",
        due_at: "2026-09-27T12:00:10Z",
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
        ],
      }),
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    const next = wrapper.get('[data-testid="next-attempt"]');
    expect(next.text()).toContain("Next attempt #2 scheduled");
    expect(wrapper.get('[data-testid="attempt-row"]').text()).toContain("·");
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

  it("shows the outcome headline and copies a report", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const api = fakeApi({ getDelivery: async () => deliveryFixture });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();

    expect(wrapper.get('[data-testid="delivery-headline"]').text()).toContain("Failed");
    await wrapper.get('[data-action="copy-report"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("dlv_1");
    expect(writeText.mock.calls[0][0]).toContain("## Attempts");
    expect(wrapper.get('[data-action="copy-report"]').text()).toContain("Copied");
  });

  it("groups attempts by retry cycle and shows the running attempt", async () => {
    const stamp = "2026-09-27T12:00:00Z";
    const api = fakeApi({
      getDelivery: async () => ({
        ...deliveryFixture,
        status: "in_progress" as const,
        cycle_attempts: 1,
        claim_started_at: new Date(Date.now() - 1500).toISOString(),
        attempts: [1, 2, 3, 4, 5, 6].map((number) => ({
          id: number,
          number,
          started_at: stamp,
          finished_at: stamp,
          outcome: "retryable_http",
          http_status: 500,
          response_excerpt: null,
        })),
      }),
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();

    const cycles = wrapper.findAll('[data-testid="attempt-cycle"]');
    expect(cycles).toHaveLength(2);
    expect(cycles[0].text()).toContain("Cycle 1");
    expect(cycles[1].text()).toContain("Cycle 2");
    expect(cycles[1].text()).toContain("replay");
    expect(cycles[1].findAll('[data-testid="attempt-row"]')).toHaveLength(3);

    const running = wrapper.get('[data-testid="attempt-in-flight"]');
    expect(running.text()).toContain("attempt 7");
    expect(running.text()).toContain("in flight");
  });

  it("keeps a single cycle unlabelled as a replay", async () => {
    const api = fakeApi({ getDelivery: async () => deliveryFixture });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    const cycles = wrapper.findAll('[data-testid="attempt-cycle"]');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].text()).toContain("Cycle 1");
    expect(cycles[0].text()).not.toContain("replay");
    expect(wrapper.find('[data-testid="attempt-in-flight"]').exists()).toBe(false);
  });

  it("clears the stale delivery when the journey selection is cleared", async () => {
    const api = fakeApi({ getDelivery: async () => deliveryFixture });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();
    expect(wrapper.text()).toContain("dlv_1");

    await wrapper.setProps({ deliveryId: null });
    await flushPromises();

    expect(wrapper.text()).not.toContain("dlv_1");
    expect(wrapper.text()).toContain("Select a branch in the journey above");
  });

  it("rechecks replay eligibility before sending the request", async () => {
    let loads = 0;
    const replayDelivery = vi.fn(async () => ({ delivery_id: "dlv_1", status: "pending" }));
    const api = fakeApi({
      getDelivery: async () => {
        loads += 1;
        return loads === 1
          ? deliveryFixture
          : { ...deliveryFixture, endpoint: { ...deliveryFixture.endpoint, enabled: false } };
      },
      replayDelivery: replayDelivery as DashboardApi["replayDelivery"],
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();

    await wrapper.get('button[data-action="replay"]').trigger("click");
    await flushPromises();

    expect(replayDelivery).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="replay-unavailable"]').text()).toContain("disabled");
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
            cycle_attempts: 1,
            last_outcome: status === "succeeded" ? "success" : "retryable_http",
            last_http_status: status === "succeeded" ? 200 : 500,
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

  it("replays every failed branch of an event from the journey", async () => {
    const replayDelivery = vi.fn(async () => ({ delivery_id: "dlv_1", status: "pending" }));
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_1",
        type: "reward_transaction_created",
        payload: {},
        created_at: "2026-09-28T09:00:00Z",
        deliveries: [
          {
            id: "dlv_1",
            endpoint_id: "ep_1",
            endpoint_name: "Partner CRM",
            endpoint_url: "http://127.0.0.1:9000/webhooks/crm",
            status: "failed",
            due_at: null,
            attempts_count: 3,
            cycle_attempts: 3,
            last_outcome: "retryable_http",
            last_http_status: 500,
          },
          {
            id: "dlv_2",
            endpoint_id: "ep_2",
            endpoint_name: "Rewards ledger",
            endpoint_url: "http://127.0.0.1:9000/webhooks/ledger",
            status: "succeeded",
            due_at: null,
            attempts_count: 1,
            cycle_attempts: 1,
            last_outcome: "success",
            last_http_status: 200,
          },
        ],
      }),
      replayDelivery: replayDelivery as unknown as DashboardApi["replayDelivery"],
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_1" } });
    await flushPromises();

    await wrapper.get('[data-action="replay-all-failed"]').trigger("click");
    await flushPromises();

    expect(replayDelivery).toHaveBeenCalledTimes(1);
    expect(replayDelivery).toHaveBeenCalledWith("dlv_1");
    expect(wrapper.get('[data-testid="replay-all-summary"]').text()).toContain("Replayed 1 of 1");
  });

  it("does not offer bulk replay when nothing failed", async () => {
    const api = fakeApi({
      getEvent: async () => ({
        id: "evt_1",
        type: "reward_transaction_created",
        payload: {},
        created_at: "2026-09-28T09:00:00Z",
        deliveries: [
          {
            id: "dlv_2",
            endpoint_id: "ep_2",
            endpoint_name: "Rewards ledger",
            endpoint_url: "http://127.0.0.1:9000/webhooks/ledger",
            status: "succeeded",
            due_at: null,
            attempts_count: 1,
            cycle_attempts: 1,
            last_outcome: "success",
            last_http_status: 200,
          },
        ],
      }),
    });
    const wrapper = mount(EventFlow, { props: { api, eventId: "evt_1" } });
    await flushPromises();
    expect(wrapper.find('[data-action="replay-all-failed"]').exists()).toBe(false);
  });

  it("acts on the endpoint straight from the delivery panel", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const setEndpointEnabled = vi.fn(async () => ({
      ...deliveryFixture.endpoint,
      enabled: false,
    }));
    const api = fakeApi({
      getDelivery: async () => deliveryFixture,
      setEndpointEnabled: setEndpointEnabled as unknown as DashboardApi["setEndpointEnabled"],
    });
    const wrapper = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
    await flushPromises();

    await wrapper.get('[data-action="toggle-endpoint"]').trigger("click");
    await flushPromises();
    expect(setEndpointEnabled).toHaveBeenCalledWith("ep_1", false);

    await wrapper.get('[data-action="copy-delivery-id"]').trigger("click");
    expect(writeText).toHaveBeenCalledWith("dlv_1");

    const receiver = wrapper.get('[data-testid="open-receiver"]');
    expect(receiver.attributes("href")).toBe("http://127.0.0.1:9000/");
  });
});

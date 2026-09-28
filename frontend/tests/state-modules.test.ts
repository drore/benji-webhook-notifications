import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboardApi } from "../src/api/client";
import type { DashboardApi, DeliveryDetail, EventDetail } from "../src/api/client";
import { createDeliveryState } from "../src/state/delivery";
import { createEventFlowState } from "../src/state/eventFlow";
import { setFrozen } from "../src/state/live";

afterEach(() => {
  vi.restoreAllMocks();
  setFrozen(false);
});

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return { ...createDashboardApi(), ...overrides } as DashboardApi;
}

function eventFixture(): EventDetail {
  return {
    id: "evt_1",
    type: "reward_transaction_created",
    payload: {},
    created_at: "2026-09-28T09:00:00Z",
    deliveries: [
      {
        id: "dlv_failed",
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
        id: "dlv_ok",
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
  };
}

describe("journey state", () => {
  it("loads an event and keeps the API errors in state, not in the component", async () => {
    const api = fakeApi({ getEvent: async () => eventFixture() });
    const state = createEventFlowState(api);

    await state.load("evt_1");
    expect(state.event.value?.id).toBe("evt_1");
    expect(state.error.value).toBeNull();

    const failing = createEventFlowState(
      fakeApi({
        getEvent: async () => {
          throw new Error("boom");
        },
      }),
    );
    await failing.load("evt_1");
    expect(failing.error.value).toBeTruthy();
  });

  it("replays only failed branches and reports blocked endpoints", async () => {
    const replayDelivery = vi.fn(async (id: string) => {
      if (id === "dlv_failed") throw new Error("disabled");
      return { delivery_id: id, status: "pending" };
    });
    const api = fakeApi({
      getEvent: async () => eventFixture(),
      replayDelivery: replayDelivery as unknown as DashboardApi["replayDelivery"],
    });
    const state = createEventFlowState(api);
    await state.load("evt_1");

    await state.replayFailed();

    expect(replayDelivery).toHaveBeenCalledTimes(1);
    expect(replayDelivery).toHaveBeenCalledWith("dlv_failed");
    expect(state.replaySummary.value).toContain("could not start");
    expect(state.replayingAll.value).toBe(false);
  });
});

describe("delivery state", () => {
  const delivery: DeliveryDetail = {
    id: "dlv_1",
    event_id: "evt_1",
    event: {
      id: "evt_1",
      type: "reward_transaction_created",
      payload: {},
      created_at: "2026-09-28T09:00:00Z",
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
    attempts: [],
  };

  it("toggles the endpoint from the state module and surfaces failures", async () => {
    const setEndpointEnabled = vi.fn(async () => ({ ...delivery.endpoint, enabled: false }));
    const api = fakeApi({
      getDelivery: async () => delivery,
      setEndpointEnabled: setEndpointEnabled as unknown as DashboardApi["setEndpointEnabled"],
    });
    const state = createDeliveryState(api);
    await state.load("dlv_1");

    expect(await state.toggleEndpoint()).toBe(true);
    expect(setEndpointEnabled).toHaveBeenCalledWith("ep_1", false);

    const failing = createDeliveryState(
      fakeApi({
        getDelivery: async () => delivery,
        setEndpointEnabled: (async () => {
          throw new Error("nope");
        }) as unknown as DashboardApi["setEndpointEnabled"],
      }),
    );
    await failing.load("dlv_1");
    expect(await failing.toggleEndpoint()).toBe(false);
    expect(failing.actionError.value).toBeTruthy();
  });
});

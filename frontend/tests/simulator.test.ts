import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import SimulatedTraffic from "../src/components/SimulatedTraffic.vue";
import { createDashboardApi } from "../src/api/client";
import type { DashboardApi } from "../src/api/client";
import { createSimulatorState, payloadFor } from "../src/state/simulator";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    ...createDashboardApi(),
    listEventTypes: async () => ({
      items: [
        { name: "reward_transaction_created", description: "Reward", schema: {} },
        { name: "member_account_linked", description: "Member", schema: {} },
      ],
    }),
    listEndpoints: async () => ({
      items: [
        {
          id: "ep_1",
          name: "CRM",
          url: "http://127.0.0.1:9000/webhooks/ep_1",
          event_types: ["e2e_custom"],
          enabled: true,
          created_at: "2026-09-28T09:00:00Z",
        },
      ],
    }),
    submitEvent: async () => ({ event_id: "evt_sim", deduplicated: false }),
    ...overrides,
  } as DashboardApi;
}

describe("simulated traffic", () => {
  it("builds payloads that satisfy the registered schemas", () => {
    expect(payloadFor("reward_transaction_created", 3)).toEqual({
      member: "m_sim_3",
      points: 30,
    });
    expect(payloadFor("member_account_linked", 4)).toEqual({ member: "m_sim_4" });
    expect(payloadFor("e2e_custom", 5)).toEqual({ simulated: true, sequence: 5 });
  });

  it("publishes immediately and then on the interval until stopped", async () => {
    vi.useFakeTimers();
    const submitEvent = vi.fn(async (_input: { idempotency_key: string; type: string }) => ({
      event_id: "evt_sim",
      deduplicated: false,
    }));
    const api = fakeApi({ submitEvent: submitEvent as unknown as DashboardApi["submitEvent"] });
    const simulator = createSimulatorState(api);

    await simulator.loadTypes();
    simulator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(submitEvent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(simulator.published.value).toBe(2);

    const calls = submitEvent.mock.calls.map(
      (call) => call[0] as { idempotency_key: string; type: string },
    );
    expect(new Set(calls.map((input) => input.idempotency_key)).size).toBe(2);
    expect(calls[0].type).toBe("e2e_custom");

    simulator.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(simulator.running.value).toBe(false);
  });

  it("stops and reports the error when a simulated publish fails", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      submitEvent: vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as DashboardApi["submitEvent"],
    });
    const simulator = createSimulatorState(api);
    await simulator.loadTypes();
    simulator.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(simulator.running.value).toBe(false);
    expect(simulator.error.value).toBeTruthy();
  });

  it("toggles from the composer control", async () => {
    const submitEvent = vi.fn(async () => ({ event_id: "evt_sim", deduplicated: false }));
    const api = fakeApi({ submitEvent: submitEvent as unknown as DashboardApi["submitEvent"] });
    const wrapper = mount(SimulatedTraffic, { props: { api } });
    await flushPromises();
    expect(wrapper.get('[data-testid="simulator-status"]').text()).toBe("idle");

    await wrapper.get('[data-testid="simulate-traffic"]').setValue(true);
    await flushPromises();
    expect(submitEvent).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="simulator-status"]').text()).toContain("pushing every 5s");

    await wrapper.get('[data-testid="simulate-traffic"]').setValue(false);
    await flushPromises();
    expect(wrapper.get('[data-testid="simulator-status"]').text()).toContain("stopped");
    wrapper.unmount();
  });
});

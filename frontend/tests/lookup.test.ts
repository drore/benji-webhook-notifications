import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import IdLookup from "../src/components/IdLookup.vue";
import { ApiError, createDashboardApi } from "../src/api/client";
import type { DashboardApi } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return { ...createDashboardApi(), ...overrides };
}

async function lookup(wrapper: ReturnType<typeof mount>, value: string): Promise<void> {
  await wrapper.get('[aria-label="Find by ID"]').setValue(value);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

describe("IdLookup", () => {
  it("rejects input that is not an event or delivery id", async () => {
    const api = fakeApi();
    const wrapper = mount(IdLookup, { props: { api } });
    await lookup(wrapper, "not-an-id");
    expect(wrapper.get('[role="alert"]').text()).toContain("evt_");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("jumps to an existing event", async () => {
    const getEvent = vi.fn(async () => ({ id: "evt_1" }));
    const api = fakeApi({ getEvent: getEvent as unknown as DashboardApi["getEvent"] });
    const wrapper = mount(IdLookup, { props: { api } });
    await lookup(wrapper, "evt_1");
    expect(getEvent).toHaveBeenCalledWith("evt_1");
    expect(wrapper.emitted("select")?.[0]).toEqual([{ eventId: "evt_1", deliveryId: null }]);
    expect((wrapper.get('[aria-label="Find by ID"]').element as HTMLInputElement).value).toBe("");
  });

  it("jumps to the event that owns a delivery", async () => {
    const getDelivery = vi.fn(async () => ({ id: "dlv_9", event: { id: "evt_7" } }));
    const api = fakeApi({ getDelivery: getDelivery as unknown as DashboardApi["getDelivery"] });
    const wrapper = mount(IdLookup, { props: { api } });
    await lookup(wrapper, "dlv_9");
    expect(getDelivery).toHaveBeenCalledWith("dlv_9");
    expect(wrapper.emitted("select")?.[0]).toEqual([{ eventId: "evt_7", deliveryId: "dlv_9" }]);
  });

  it("reports an unknown id without changing the selection", async () => {
    const api = fakeApi({
      getEvent: async () => {
        throw new ApiError("not_found", "Event not found.", 404);
      },
    });
    const wrapper = mount(IdLookup, { props: { api } });
    await lookup(wrapper, "evt_missing");
    expect(wrapper.get('[role="alert"]').text()).toContain("No event with that ID");
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});

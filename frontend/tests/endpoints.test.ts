import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import EndpointsPanel from "../src/components/EndpointsPanel.vue";
import { ApiError, createDashboardApi } from "../src/api/client";
import type { DashboardApi, Endpoint } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

export const endpointFixture: Endpoint = {
  id: "ep_1",
  name: "CRM",
  url: "http://127.0.0.1:9000/webhooks/crm",
  event_types: ["a"],
  enabled: true,
  created_at: "2026-09-27T12:00:00Z",
};

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return { ...createDashboardApi(), ...overrides };
}

describe("EndpointsPanel", () => {
  it("shows the secret once and never after dismissal", async () => {
    const api = fakeApi({
      listEndpoints: async () => ({ items: [] }),
      createEndpoint: async () => ({
        endpoint: { ...endpointFixture, enabled: false },
        secret: "whsec_once",
      }),
    });
    const wrapper = mount(EndpointsPanel, { props: { api } });
    await flushPromises();
    await wrapper.get('input[aria-label="Endpoint name"]').setValue("CRM");
    await wrapper
      .get('input[aria-label="Endpoint URL"]')
      .setValue("http://127.0.0.1:9000/webhooks/crm");
    await wrapper.get('[aria-label="Event types"]').setValue("a");
    await wrapper.get('button[data-action="create-endpoint"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="secret-banner"]').text()).toContain("whsec_once");
    await wrapper.get('[data-action="dismiss-secret"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="secret-banner"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("whsec_once");
  });

  it("disables the toggle while pending and surfaces errors inline", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = fakeApi({
      listEndpoints: async () => ({ items: [endpointFixture] }),
      setEndpointEnabled: async () => {
        await gate;
        throw new ApiError("validation_error", "Endpoint URL rejected.", 400);
      },
    });
    const wrapper = mount(EndpointsPanel, { props: { api } });
    await flushPromises();
    const toggle = wrapper.get('button[data-action="disable-endpoint"]');
    await toggle.trigger("click");
    expect((toggle.element as HTMLButtonElement).disabled).toBe(true);
    release();
    await flushPromises();
    expect(wrapper.text()).toContain("Endpoint URL rejected.");
  });
});

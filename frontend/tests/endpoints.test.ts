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

  it("keeps every undismissed secret visible until it is dismissed", async () => {
    let created = 0;
    const api = fakeApi({
      listEndpoints: async () => ({ items: [] }),
      createEndpoint: async () => {
        created += 1;
        return {
          endpoint: { ...endpointFixture, id: `ep_${created}`, name: `CRM ${created}`, enabled: false },
          secret: `whsec_${created}`,
        };
      },
    });
    const wrapper = mount(EndpointsPanel, { props: { api } });
    await flushPromises();
    for (const label of ["One", "Two"]) {
      await wrapper.get('input[aria-label="Endpoint name"]').setValue(label);
      await wrapper.get('[aria-label="Event types"]').setValue("a");
      await wrapper.get('button[data-action="create-endpoint"]').trigger("click");
      await flushPromises();
    }

    const banners = wrapper.findAll('[data-testid="secret-banner"]');
    expect(banners).toHaveLength(2);
    expect(banners[0].text()).toContain("whsec_1");
    expect(banners[1].text()).toContain("whsec_2");

    await banners[0].get('[data-action="dismiss-secret"]').trigger("click");
    await wrapper.vm.$nextTick();
    const remaining = wrapper.findAll('[data-testid="secret-banner"]');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text()).toContain("whsec_2");
  });
});

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import EventComposer from "../src/components/EventComposer.vue";
import { ApiError, createDashboardApi } from "../src/api/client";
import type { DashboardApi } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

const REGISTRY = {
  items: [
    {
      name: "reward_transaction_created",
      description: "Reward transaction recorded for a member.",
      schema: {
        type: "object",
        required: ["member", "points"],
        properties: {
          member: { type: "string" },
          points: { type: "integer" },
        },
      },
    },
    {
      name: "member_account_linked",
      description: "Member account linked.",
      schema: {
        type: "object",
        required: ["member"],
        properties: { member: { type: "string" } },
      },
    },
  ],
};

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    ...createDashboardApi(),
    listEndpoints: async () => ({ items: [] }),
    listEventTypes: async () => REGISTRY,
    ...overrides,
  } as DashboardApi;
}

describe("EventComposer schema enforcement", () => {
  it("enforces the registered schema by default and shows the expected shape", async () => {
    const submitEvent = vi.fn(async () => ({ event_id: "evt_1", deduplicated: false }));
    const api = fakeApi({ submitEvent: submitEvent as unknown as DashboardApi["submitEvent"] });
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();

    const toggle = wrapper.get('[data-testid="enforce-schema"]').element as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(wrapper.get('[data-testid="expected-shape"]').text()).toContain("member (string)");
    expect(wrapper.get('[data-testid="expected-shape"]').text()).toContain("points (integer)");

    await wrapper.get('textarea[aria-label="Payload"]').setValue('{"member":"m_1","points":3}');
    await wrapper.get('button[data-action="submit-event"]').trigger("click");
    await flushPromises();
    expect(submitEvent).toHaveBeenCalledWith(expect.objectContaining({ enforce_schema: true }));
  });

  it("publishes without the flag once the operator turns the switch off", async () => {
    const submitEvent = vi.fn(async () => ({ event_id: "evt_2", deduplicated: false }));
    const api = fakeApi({ submitEvent: submitEvent as unknown as DashboardApi["submitEvent"] });
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();

    await wrapper.get('[data-testid="enforce-schema"]').setValue(false);
    await wrapper.get('textarea[aria-label="Payload"]').setValue('{"anything":1}');
    await wrapper.get('button[data-action="submit-event"]').trigger("click");
    await flushPromises();
    expect(submitEvent).toHaveBeenCalledWith(expect.objectContaining({ enforce_schema: false }));
  });

  it("disables the switch for a type with no registered schema", async () => {
    const api = fakeApi();
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();

    await wrapper.get('select[aria-label="Event type"]').setValue("custom");
    await wrapper.get('input[aria-label="Custom event type"]').setValue("e2e_unrouted_1");
    await flushPromises();

    const toggle = wrapper.get('[data-testid="enforce-schema"]').element as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(wrapper.text()).toContain("no schema registered");
  });

  it("explains why enforcement is disabled and how to change it", async () => {
    const api = fakeApi();
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();

    // A registered type needs no explanation.
    expect(wrapper.find('[data-testid="enforce-schema-tip"]').exists()).toBe(false);

    await wrapper.get('select[aria-label="Event type"]').setValue("custom");
    await wrapper.get('input[aria-label="Custom event type"]').setValue("e2e_unrouted_1");
    await flushPromises();

    const tip = wrapper.get('[data-testid="enforce-schema-tip"]');
    expect(tip.text()).toContain("No payload schema is registered");
    expect(tip.text()).toContain("e2e_unrouted_1");
    expect(tip.text()).toContain("member_account_linked");
    expect(tip.text()).toContain("ask your Benji contact");
    // Customer-facing copy: no repository paths or file names.
    expect(tip.text()).not.toMatch(/\.py\b|backend\/|docs\//);
    expect(wrapper.get(".switch").attributes("title")).toContain("e2e_unrouted_1");
    expect(wrapper.get(".switch").attributes("title")).not.toMatch(/\.py\b|backend\//);
  });

  it("renders a schema violation inline", async () => {
    const api = fakeApi({
      submitEvent: vi.fn(async () => {
        throw new ApiError(
          "validation_error",
          "Payload does not match the registered schema — points: Input should be greater than or equal to 0",
          400,
        );
      }),
    });
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();

    await wrapper.get('textarea[aria-label="Payload"]').setValue('{"member":"m_1","points":-1}');
    await wrapper.get('button[data-action="submit-event"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("points: Input should be greater than or equal to 0");
  });
});

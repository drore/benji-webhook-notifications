import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import EventComposer from "../src/components/EventComposer.vue";
import { ApiError, createDashboardApi } from "../src/api/client";
import type { DashboardApi } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    ...createDashboardApi(),
    listEndpoints: async () => ({ items: [] }),
    ...overrides,
  } as DashboardApi;
}

async function submitValidEvent(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('select[aria-label="Event type"]').setValue("reward_transaction_created");
  await wrapper.get('textarea[aria-label="Payload"]').setValue("{}");
  await wrapper.get('button[data-action="submit-event"]').trigger("click");
  await flushPromises();
}

describe("EventComposer", () => {
  it("reports deduplicated resubmission with the original event id", async () => {
    const api = fakeApi({
      submitEvent: vi.fn(async () => ({ event_id: "evt_orig", deduplicated: true })),
    });
    const wrapper = mount(EventComposer, { props: { api } });
    await submitValidEvent(wrapper);
    expect(wrapper.get('[data-testid="deduplicated"]').text()).toContain("evt_orig");
  });

  it("keeps the key and offers check-or-resend after a transport failure", async () => {
    let firstKey = "";
    const submitEvent = vi.fn(async (input: { idempotency_key: string }) => {
      firstKey = input.idempotency_key;
      throw new ApiError("transport_error", "Could not reach the API.", null);
    });
    const api = fakeApi({ submitEvent: submitEvent as DashboardApi["submitEvent"] });
    const wrapper = mount(EventComposer, { props: { api } });
    await submitValidEvent(wrapper);
    expect(wrapper.find('[data-testid="uncertain"]').exists()).toBe(true);
    await wrapper.get('button[data-action="check-resend"]').trigger("click");
    await flushPromises();
    expect(submitEvent.mock.calls[1][0].idempotency_key).toBe(firstKey);
    await wrapper.get('button[data-action="new-key"]').trigger("click");
    const keyInput = wrapper.get('input[data-testid="submission-key"]')
      .element as HTMLInputElement;
    expect(keyInput.value).not.toBe(firstKey);
    expect(keyInput.value).not.toBe("");
  });

  it("shows a conflict inline without losing the draft", async () => {
    const api = fakeApi({
      submitEvent: vi.fn(async () => {
        throw new ApiError("idempotency_conflict", "That key was used with different content.", 409);
      }),
    });
    const wrapper = mount(EventComposer, { props: { api } });
    await submitValidEvent(wrapper);
    expect(wrapper.get('[data-testid="conflict"]').text()).toContain("different content");
  });

  it("warns when no enabled endpoint subscribes to the selected type", async () => {
    const api = fakeApi();
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();
    expect(wrapper.get('[data-testid="no-subscribers"]').text()).toContain(
      "No enabled endpoint subscribes",
    );
  });

  it("tells how many enabled endpoints will receive the event", async () => {
    const api = fakeApi({
      listEndpoints: async () => ({
        items: [
          {
            id: "ep_1",
            name: "CRM",
            url: "http://127.0.0.1:9000/webhooks/ep_1",
            event_types: ["reward_transaction_created"],
            enabled: true,
            created_at: "2026-09-27T12:00:00Z",
          },
          {
            id: "ep_2",
            name: "Ledger",
            url: "http://127.0.0.1:9000/webhooks/ep_2",
            event_types: ["campaign_updated"],
            enabled: true,
            created_at: "2026-09-27T12:00:00Z",
          },
        ],
      }),
    });
    const wrapper = mount(EventComposer, { props: { api } });
    await flushPromises();
    expect(wrapper.get('[data-testid="subscriber-hint"]').text()).toContain(
      "1 enabled endpoint(s)",
    );
  });
});

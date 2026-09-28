import { describe, expect, it } from "vitest";

import { isDeliveryId, isEventId, readSelection, selectionSearch } from "../src/state/location";

describe("selection in the URL", () => {
  it("reads an event and a delivery id from the query string", () => {
    expect(readSelection("?event=evt_abc123&delivery=dlv_def456")).toEqual({
      eventId: "evt_abc123",
      deliveryId: "dlv_def456",
    });
  });

  it("reads a partial selection", () => {
    expect(readSelection("?event=evt_abc123")).toEqual({
      eventId: "evt_abc123",
      deliveryId: null,
    });
    expect(readSelection("")).toEqual({ eventId: null, deliveryId: null });
  });

  it("ignores values that are not ids", () => {
    expect(readSelection("?event=../../etc/passwd&delivery=javascript:alert(1)")).toEqual({
      eventId: null,
      deliveryId: null,
    });
    expect(isEventId("evt_abc123")).toBe(true);
    expect(isEventId("dlv_abc123")).toBe(false);
    expect(isDeliveryId("dlv_abc123")).toBe(true);
    expect(isDeliveryId("evt_abc123")).toBe(false);
  });

  it("builds a query string from the ids that are set", () => {
    expect(selectionSearch({ eventId: "evt_1", deliveryId: null })).toBe("?event=evt_1");
    expect(selectionSearch({ eventId: "evt_1", deliveryId: "dlv_2" })).toBe(
      "?event=evt_1&delivery=dlv_2",
    );
    expect(selectionSearch({ eventId: null, deliveryId: null })).toBe("");
  });
});

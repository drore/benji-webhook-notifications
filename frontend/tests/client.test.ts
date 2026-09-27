import { describe, expect, it, vi } from "vitest";
import { ApiError, createDashboardApi } from "../src/api/client";

describe("client", () => {
  it("maps API error envelopes to ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ code: "idempotency_conflict", message: "Changed content." }),
      { status: 409, headers: { "content-type": "application/json" } })));
    await expect(createDashboardApi().submitEvent({ idempotency_key: "k", type: "t", payload: {} }))
      .rejects.toMatchObject({ code: "idempotency_conflict", httpStatus: 409 });
  });
  it("maps transport failures to ApiError with null status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(createDashboardApi().getOverview())
      .rejects.toMatchObject({ httpStatus: null });
  });
});

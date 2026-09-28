import { describe, expect, it } from "vitest";

import type { DeliveryDetail } from "../src/api/client";
import { buildDeliveryReport, deliveryHeadline } from "../src/state/report";

const stamp = "2026-09-28T08:05:11.000Z";

export const failedDelivery: DeliveryDetail = {
  id: "dlv_c4ff2551ad1e",
  event_id: "evt_f06034cb6e7d",
  event: {
    id: "evt_f06034cb6e7d",
    type: "reward_transaction_created",
    payload: { member: "m_1", points: 10 },
    created_at: stamp,
  },
  endpoint: {
    id: "ep_1",
    name: "Partner CRM",
    url: "http://127.0.0.1:9000/webhooks/ep_bf524c02abf4",
    enabled: true,
  },
  status: "failed",
  due_at: null,
  cycle_attempts: 3,
  claim_started_at: null,
  attempts: [1, 2, 3, 4, 5, 6].map((number) => ({
    id: number,
    number,
    started_at: stamp,
    finished_at: stamp,
    outcome: "retryable_http",
    http_status: 500,
    response_excerpt: '{"error":"scripted failure"}',
  })),
};

describe("delivery reporting", () => {
  it("summarises the outcome on one line", () => {
    const headline = deliveryHeadline(failedDelivery);
    expect(headline).toContain("Failed");
    expect(headline).toContain("Retryable HTTP 500");
    expect(headline).toContain("3 of 3 in this cycle");
    expect(headline).toContain("6 overall");
  });

  it("builds a copyable markdown report with ids, payload and attempts", () => {
    const report = buildDeliveryReport(failedDelivery, "http://127.0.0.1:5173/?event=evt_f06034cb6e7d");
    expect(report).toContain("Delivery report");
    expect(report).toContain("dlv_c4ff2551ad1e");
    expect(report).toContain("evt_f06034cb6e7d");
    expect(report).toContain("Partner CRM");
    expect(report).toContain('"member": "m_1"');
    expect(report).toContain("#6");
    expect(report).toContain("scripted failure");
    expect(report).toContain("http://127.0.0.1:5173/?event=evt_f06034cb6e7d");
    expect(report).not.toContain("whsec_");
  });
});

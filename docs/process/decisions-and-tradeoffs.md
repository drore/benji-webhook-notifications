---
title: Decisions and trade-offs — lean Benji webhook build
date_created: 2026-09-28
last_updated: 2026-09-28
status: living
tags: [benji, take-home, decisions, trade-offs]
---

# Decisions and trade-offs

The [design specification](../spec/design.md) defines accepted behavior, the [implementation plan](../plan/implementation-plan.md) defines how it is built, and this register explains **what was chosen, why, what it costs, and what would cause a revisit**. The spec is the source of truth for behavior; this file is not evidence that the implementation works — the suites and the plan's evidence section carry that.

**Status key:** **Confirmed** = Dror approved it in design review or asked for it; **Selected** = engineering choice inside the confirmed scope; **Deferred** = a known production or optional extension. Playtest-driven revisions on 2026-09-28 are marked in the entry.

## Shape, scope, and process

| ID | Status and source | Decision and reason | Trade-off, limit, or revisit trigger |
| --- | --- | --- | --- |
| D-01 | Confirmed · Dror, 2026-09-27 | Lean rebuild of the earlier Benji attempt: reuse its settled contracts (endpoint-owned subscriptions with fan-out, HMAC signing with a one-time secret, ±300s window plus delivery-id dedupe, 2s/4s three-attempt backoff with replay, server event IDs plus a separate sender idempotency key, loopback-only destination policy, `{code, message}` errors) and deliberately drop the workflow/version/cutover/archive layer. | Much smaller product surface and a single endpoint model; the dashboard cannot demonstrate endpoint evolution. Revisit if endpoint versioning becomes a real requirement rather than a production idea. |
| D-02 | Confirmed · Dror | Treat it as a one-day exercise under the assignment's time constraint; freeze the spec on approval; record real cuts instead of relabeling them. | Less polish and no load testing. The focused-time record lives in the worklog; spec changes require Dror's explicit approval. |
| D-03 | Confirmed · Dror | One fixed local customer, loopback only, no login. | Keeps the demo honest and small. This is explicitly not operator authentication or a hosting model; revisit before any shared deployment. |

## Architecture and runtime

| ID | Status and source | Decision and reason | Trade-off, limit, or revisit trigger |
| --- | --- | --- | --- |
| D-04 | Selected | One FastAPI process serves the API and runs the delivery worker in its lifespan, with store/worker/signing/policy kept behind explicit interfaces. | Fewest moving parts to run and explain, and a split stays possible. The worker's lifetime is tied to the API process and there is no horizontal dispatch; a real deployment needs a separate, shared-queue worker. |
| D-05 | Selected | SQLite in WAL mode is the durable queue: event plus matched deliveries are persisted in one transaction before any HTTP, and `UNIQUE(event_id, endpoint_id)` enforces logical uniqueness. | Zero external infrastructure and inspectable state, but one writer and one host. A broker-backed design is the production path. |
| D-06 | Selected | The dashboard polls the API every 2 seconds while the tab is visible. | Simple and adequate at demo scale; up to two seconds of staleness (a just-disabled endpoint can still show a replay button until the next poll, and the server rejects that request safely). SSE/websockets would remove the window. |
| D-07 | Selected | The demo receiver keeps configuration and dedupe memory in process and supports scripted behaviors (`success`, `fail_once`, `always_fail`, `slow`, `slow_fail`, `redirect`, `fail_count:<n>`). | One command to run and a controllable demo; restarting the receiver forgets secrets and dedupe, which is stated in the README. Revisit if the walkthrough needs a durable receiver. |

## Delivery semantics

| ID | Status and source | Decision and reason | Trade-off, limit, or revisit trigger |
| --- | --- | --- | --- |
| D-08 | Selected · accepted spec | One **logical delivery** per `(event_id, endpoint_id)` with a stable delivery ID; retries and replay append attempts (numbers increase monotonically) instead of creating new deliveries. | Guarantees logical uniqueness locally, not exactly-once remote processing; a timed-out request may still have been processed, so the receiver dedupes by delivery ID. |
| D-09 | Confirmed | Server-generated event ID plus a separate 1–128 character sender idempotency key: same key and canonical-equal content returns the original event with no new deliveries; changed content is a `409` conflict; a fresh key is a new occurrence. | A resend after an uncertain submission is safe, while identical real-world occurrences stay distinct. The sender must retain its key to recover the original result. |
| D-10 | Confirmed | First attempt is immediate; transport errors, the 2-second total timeout, HTTP 408/429, and 5xx retry after 2s then 4s measured from the prior attempt's completion, three attempts per cycle. Other non-2xx and all 3xx are terminal; redirects are never followed. | Fast, reproducible backoff for the demo. Production would tune the schedule, add jitter, and measure capacity; a retry can repeat a POST whose outcome is unknown. |
| D-11 | Confirmed | Replay starts a new bounded cycle on the **same** failed delivery and keeps prior attempts; only `failed` deliveries are eligible, a disabled endpoint blocks replay until resumed, and concurrent replays yield at most one new cycle. | Preserves investigation history and receiver idempotency; attempt history grows and needs transactional guarding. |
| D-12 | Confirmed | Disable stops new routing and pauses the endpoint's queued deliveries with their due time and attempt budget retained; an in-flight attempt may finish; resume restores paused work. | Gives a real stop control without rewriting history. Paused deliveries are invisible to "retrying" signals by design. |
| D-13 | Selected, **revised 2026-09-28** | Claims use a 10-second lease with at most four attempts globally and one per endpoint. Originally expired leases were swept only at worker startup; the playtest showed that a restart inside the lease window stranded the delivery in `in_progress` forever, so the worker now sweeps expired leases on every tick and records the lost attempt as `interrupted`. | Recovery now happens for any restart ordering. Still open: a lease swept while its endpoint is disabled is recorded as `retrying` rather than `paused` until the next resume. |

## Trust boundary and data handling

| ID | Status and source | Decision and reason | Trade-off, limit, or revisit trigger |
| --- | --- | --- | --- |
| D-14 | Confirmed | Each endpoint gets a 32-byte secret shown once as `whsec_` + unpadded base64url. Requests carry `X-Webhook-Delivery-Id`, `X-Webhook-Timestamp`, and `v1=` HMAC-SHA256 over `{timestamp}.{delivery_id}.` plus the raw body; the receiver compares in constant time, rejects malformed headers and timestamps outside ±300s, and never returns or logs the secret again. | Independent verification without a shared service. No rotation, revocation, or key storage story — production needs managed secrets, and timestamp freshness does not replace delivery-id idempotency. |
| D-15 | Confirmed | Destination policy is exactly the configured receiver origin plus `/webhooks/{segment}` (`[A-Za-z0-9._-]{1,64}`), with no credentials, query, or fragment; the URL is revalidated at dispatch and redirects are refused. | A testable SSRF boundary that fails closed for this demo; arbitrary public destinations are unsupported. Production needs HTTPS with DNS/reputation checks and egress control. |
| D-16 | Confirmed, **extended 2026-09-28** | Secrets are not re-readable, so every unacknowledged secret stays on screen until the operator dismisses it; creating another endpoint must not swallow a secret that was never copied. | Prevents an unrecoverable endpoint. The panel can accumulate banners until acknowledged; the alternative (re-reading secrets) would violate the one-time rule. |
| D-17 | Confirmed | Payloads, excerpts, and error messages render as escaped text, response excerpts are bounded at 1 KiB, and API errors use the safe `{code, message}` envelope without secrets, payloads, or stack traces. | Bounded blast radius for a demo; retention, redaction, and tenant scoping remain production work. |

## Dashboard and evidence

| ID | Status and source | Decision and reason | Trade-off, limit, or revisit trigger |
| --- | --- | --- | --- |
| D-18 | Confirmed · Dror | The dashboard is an event-centered journey on a read-only Vue Flow canvas: one node per delivery with status, attempt progress, and an inline `?` explanation of the last HTTP outcome, animating only while an attempt is actually in flight. | Immediate comprehension of fan-out, at the cost of a layout dependency and a fixed (non-editable) canvas. |
| D-19 | Selected, **revised 2026-09-28** | Attempt progress is reported per cycle: the API exposes `cycle_attempts` alongside the lifetime attempt count, and nodes read "failed after 3 of 3 this cycle · 6 attempts overall" instead of the ambiguous "attempt 6 of 3". | Accurate per-cycle budget display; slightly longer node text and one extra field in the event-detail payload. |
| D-20 | Selected, **revised 2026-09-28** | The delivery panel resets when the event selection changes and re-reads the delivery before replaying. | Removes a stale branch from another event and prevents acting on a two-second-old enable/disable state; the click costs one extra fetch. |
| D-21 | Confirmed · Dror | Evidence comes from pytest unit and integration tests against a real receiver, Vitest component tests, and a Playwright suite that boots all three services; the plan records the commands, counts, and the fresh-clone verification. | Local evidence never implies production readiness; the E2E suite is chromium-only and serial. |
| D-23 | Confirmed · Dror, 2026-09-28 | The dashboard keeps its selection in the URL (`?event=evt_…&delivery=dlv_…`, with ids validated against `evt_`/`dlv_` patterns) and offers a header **Find by ID** box that resolves a pasted event or delivery id to the matching journey and delivery. Requested as the first investigation enhancement. | A view can be reloaded, bookmarked, or pasted from a log; only ids travel in the URL, never payloads or secrets, and an unknown id falls back to the existing safe error state. Revisit if the dashboard grows a fuller routing or saved-views model. |
| D-24 | Confirmed · Dror, 2026-09-28 | Event payload contracts are declared as **pydantic models registered per event type** (`backend/app/event_schemas.py`), and intake validates against them only when the submission asks for it. The dashboard exposes this as an **Enforce schema** switch, on by default for a registered type; `POST /api/events` therefore gains an optional `enforce_schema` flag that defaults to off, and `GET /api/event-types` publishes each registered type with a generated JSON Schema. `reward_transaction_created` requires `member` and non-negative integer `points`; `member_account_linked` requires `member`; extra fields are rejected. | No new dependency (pydantic is already pinned) and no change for API clients or unregistered/custom types, which keep the structural checks. Rejections happen before acceptance, so a bad payload never creates an event or consumes an idempotency key, and messages name field paths without echoing payload values. The trade-off is that the contract lives in code and a new type needs one model plus one registry entry; the spec's intake and error clauses still need Dror's one-line amendment to record the new rejection path. |
| D-25 | Confirmed · Dror, 2026-09-28 | The disabled **Enforce schema** switch explains itself: hovering the switch row shows why enforcement is unavailable and how to change it, in **customer-facing language** — no repository paths, file names, or internal jargon. When no schema is registered for the selected type the switch is disabled with the reason, and the copy names the registered types instead of pointing at code. | Keeps the demo presentable to a reviewer who is not reading the repository; the operator-facing detail stays in this register and the README. A unit test and the browser test both assert the copy contains no `.py`/`backend/` references so it cannot regress. |
| D-26 | Confirmed · Dror, 2026-09-28 | A **Delivery trend** card shows one event type's history: `GET /api/event-types/{type}/stats?hours=&buckets=` returns bucketed counts by current delivery status plus totals, success rate, average attempts per delivery, and average attempt duration, and the dashboard renders them as summary chips and an inline SVG bar chart (no charting dependency). | A delivery counts in the bucket where it was created and under its **current** status, so the newest bucket can still change while a delivery retries or is replayed — stated in the card's hint. The window is bucketed (6h/24h/7d presets) rather than raw events; longer retention, percentiles, and per-endpoint cuts are deferred. |
| D-27 | Confirmed · Dror, 2026-09-28 | The journey offers **Replay all failed** for the selected event, and the delivery panel acts on its endpoint (**Disable**/**Resume**), copies the delivery id, and opens the receiver. | Turns investigation into action without leaving the page. A disabled endpoint blocks replay, so bulk replay reports how many started and which were blocked instead of failing silently; per-branch replay is unchanged. |

## Deferred before any public or multi-tenant use

| ID | Status and source | Decision and reason | Trade-off, limit, or revisit trigger |
| --- | --- | --- | --- |
| D-22 | Deferred | Authentication/RBAC, endpoint editing and versioning, secret rotation, retention and redaction policy, per-tenant rate limits, jittered backoff, broker-backed horizontal dispatch, SSE/websockets, load testing, and a cross-browser matrix. | Deliberately out of the one-day scope and named so they are not mistaken for solved problems. Each is a precondition for claims beyond this local demo. |

## Change history

- **2026-09-28:** register created to consolidate the decisions made during the 2026-09-27 design and implementation pass, including the playtest-driven revisions recorded on D-13, D-16, D-19, and D-20. No accepted behavior changed without the corresponding spec or plan text.

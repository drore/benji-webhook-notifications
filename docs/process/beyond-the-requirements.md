---
title: Beyond the requirements — what this submission adds
date_created: 2026-09-28
status: final
tags: [benji, take-home, extras, review]
---

# Beyond the requirements

The assignment lists system outcomes, dashboard requirements, and deliverables, and then says: *"These are the basic building blocks. We understand (and expect!) you to have an opinion to enrich the dashboard."* This document separates the two: what satisfies the brief, and what was added on top of it.

Nothing here replaces a requirement, and nothing here claims production readiness — the cuts are listed at the end and in [decisions D-31/D-32](decisions-and-tradeoffs.md).

## 1. The brief, satisfied

| Assignment line | Where | Proof |
| --- | --- | --- |
| Configurable subscriptions (multiple endpoints, one or more event types) | `POST /api/endpoints` + Endpoints panel | `test_fan_out_shared_single_and_none`, E2E endpoint lifecycle |
| Reliable delivery with a chosen, justified retry mechanism | Worker + [D-10](decisions-and-tradeoffs.md) | `test_classification_and_schedule_are_exact`, `test_fail_once_then_success_appends_attempt`, `test_exhaustion_terminates_failed_after_three_attempts` |
| Authenticated delivery | HMAC-SHA256, one-time secret ([D-14](decisions-and-tradeoffs.md)) | `test_secret_shape_and_signature`, `test_verify_rejects_tampering_and_skew`, receiver suite, E2E tampered-signature |
| Replay-able failures | `POST /api/deliveries/{id}/replay` | Five tests in `tests/test_replay.py` |
| Unique delivery per event/endpoint | `UNIQUE(event_id, endpoint_id)`, stable delivery ID | `test_concurrent_same_key_creates_one_event_and_deliveries`, `test_one_in_flight_per_endpoint` |
| Observable delivery (UI, not logs) | Journey canvas + delivery panel | E2E reviewer journey |
| Dashboard: endpoints, event trigger + dedupe surfacing, live view, attempt inspection + replay, async UX, structure | Dashboard + [D-33](decisions-and-tradeoffs.md) | 21 browser tests |
| Deliverables: plan, backend, dashboard, tests, README, AI note | `docs/plan`, `backend`, `frontend`, `tests`, `README.md`, `docs/process/ai-usage.md` | fresh-clone run of all suites |

## 2. Delivery-engine depth (beyond "failures are retried")

- **A stated classification table, not a vibe**: transport errors, the 2s total timeout, HTTP 408/429, and 5xx retry; every other non-2xx and all 3xx fail terminally; redirects are never followed.
- **Backoff measured from the prior attempt's completion** (2s then 4s), which the tests assert rather than assume.
- **Attempts as an append-only ledger**: every attempt stores start/end, outcome, HTTP status and a ≤1 KiB excerpt; numbering is monotonic across retries *and* replay cycles.
- **Replay as a bounded cycle on the same delivery**: same delivery ID, three fresh attempts, previous attempts retained, concurrent replays collapse to one winner, disabled endpoints block replay.
- **Worker hygiene**: 10s claims with atomic conditional updates, four concurrent attempts, one in-flight attempt per endpoint, and a **runtime lease sweep** that records an `interrupted` attempt and continues within budget — this was a real hole found by playtesting and fixed test-first ([D-13](decisions-and-tradeoffs.md)).
- **Honest uncertainty**: a timed-out attempt is labelled outcome-unknown at the receiver, never "not processed".
- **Disable is not delete**: queued work pauses with its due time and attempt budget intact, resume continues it, and history is never rewritten.

## 3. Trust boundary (beyond "recipients can trust us")

- HMAC-SHA256 over `{timestamp}.{delivery_id}.` + raw body, so a signature is bound to one delivery and a time window (±300s), compared in constant time.
- **One-time secrets that behave like one-time secrets**: `whsec_` + 32 random bytes, never returned again, never logged, never in a list projection — and *unacknowledged* secrets stay on screen until dismissed, because losing one bricks an endpoint ([D-16](decisions-and-tradeoffs.md)).
- **SSRF containment even though it is a local demo**: destinations are restricted to the configured loopback origin and `/webhooks/{segment}`, revalidated at dispatch, with credentials/query/fragment and redirects refused.
- **Safe-by-default errors**: one `{code, message}` envelope, no stack traces, no payload echoes — and schema violations report field paths only.
- Escaped rendering everywhere, bounded excerpts, and no secrets in URLs (deep links carry ids only).

## 4. Dashboard (beyond the seven required panels)

- **Event-centred journey** instead of a list of rows: one node per matching endpoint, status pills, and edges that animate only while an attempt is actually in flight.
- **Explanations in place**: every failed or retrying branch carries a `?` that says what that HTTP outcome means *in context* and what happens next.
- **Cycle-grouped attempt timeline** with a live in-flight row fed by the delivery's claim time, so a running delivery is visible rather than "no attempts yet" ([D-19](decisions-and-tradeoffs.md)).
- **Investigation entry points**: the selection lives in the URL (`?event=…&delivery=…`) and a header **Find by ID** box resolves any pasted `evt_…`/`dlv_…`.
- **Server-side filters and facets** driven by the header signals (`Needs attention`, `Retrying`), plus type/endpoint filters and pagination with a `total` count.
- **Delivery trend per event type**: `GET /api/event-types/{type}/stats` with bucketed volume, success rate, failures, average attempts per delivery, and attempt latency, rendered as chips plus an inline SVG chart ([D-26](decisions-and-tradeoffs.md)).
- **Act, don't just look**: bulk **Replay all failed** with a report of what started and what a disabled endpoint blocked, plus per-delivery disable/resume, copy-id, and open-receiver actions ([D-27](decisions-and-tradeoffs.md)).
- **Hand-off quality**: a one-line outcome headline and a **Copy report** button that produces a Markdown incident report (ids, endpoint, payload, per-attempt lines).
- **Reading a moving target**: one control pauses every panel, **Refresh now** re-fetches everything, each card states "live" or "paused · updated …", and a pulsing dot marks the live state (static when paused, still under reduced motion) ([D-28](decisions-and-tradeoffs.md)).
- **Simulated traffic**: the publish card can push schema-conforming events on an interval *through the real intake path*, so a reviewer sees the system behave without a second terminal ([D-29](decisions-and-tradeoffs.md)).
- **Re-arrangeable panels**: drag the corner handle or focus it and press ↑/↓; the layout is remembered, glides via FLIP, and resets on demand ([D-30](decisions-and-tradeoffs.md)).
- **Consistency pass**: loading placeholders, empty states with next steps, actions disabled while their request is in flight, `role="alert"`/`role="status"` on every banner, and a stale banner that recovers on its own.

## 5. Payload contracts (beyond "fire an event with a chosen payload")

- An **event-type registry** declared as pydantic models, not prose: `reward_transaction_created` (`member`, `points ≥ 0`) and `member_account_linked` (`member`), extra fields rejected.
- **Enforcement is a per-submission choice**: the composer has an **Enforce schema** switch, on by default for registered types, and the API flag defaults to *off* so existing clients and custom types are unaffected ([D-24](decisions-and-tradeoffs.md)).
- **Discovery**: `GET /api/event-types` publishes each type with a generated JSON Schema; the composer's dropdown and its "expected: …" hint read from it, so adding a type is one model plus one registry entry.
- **Rejection is safe**: 400 with field paths only, no event created, and the idempotency key is not consumed — the rejection path is documented in the spec (FR-01/FR-09, amended with approval).
- **The switch explains itself** in customer-facing language — including when it is disabled, with no repository paths or internal jargon ([D-25](decisions-and-tradeoffs.md)).

## 6. Engineering evidence and process

- **Specification-driven, test-first**: a frozen spec with traced requirements and acceptance criteria, amendments recorded with approval markers, and a plan whose tasks name their observable behaviour.
- **A decision register** (33 entries) with rationale, alternatives, costs, and explicit revisit triggers — including why polling beats SSE/WebSockets here ([D-06](decisions-and-tradeoffs.md)), the frontend layering ([D-33](decisions-and-tradeoffs.md)), and what scaling would actually take ([D-31/D-32](decisions-and-tradeoffs.md)).
- **A testing strategy with real boundaries**: unit → integration against a real receiver (no mocked HTTP) → component → browser E2E that boots all three services on free ports → **fresh-clone reproduction** of every suite.
- **A playtest that found real defects**, all fixed test-first: a stranded delivery after a crash inside the lease window, a delivery panel that showed another event's branch, ambiguous per-cycle wording, a secret that could be lost silently, and a reorder control that was unusable on a narrow window.
- **Honest records**: a worklog with reconstructed, labelled time estimates (≈7h05m, inside the one-day box), an AI-usage note with verbatim prompt excerpts and a stated limits section, and numbers in the docs that match the suites.
- **Small conveniences for a reviewer**: a mermaid architecture diagram and a "Reviewing locally" path in the README, a seed script, and `GET /api/health` for smoke checks.

## 7. What was deliberately not added

Authentication/RBAC, multi-tenancy and quotas, secret rotation and managed secret storage, public HTTPS destination policy with DNS/IP pinning, retention and redaction policy, rate limiting, jittered backoff, horizontal dispatch, SSE/WebSockets, load testing, cross-browser automation, and coverage measurement. Each is named with a reason and a revisit trigger in [D-31/D-32](decisions-and-tradeoffs.md) and section 12 of the [design specification](../spec/design.md) rather than implied away.

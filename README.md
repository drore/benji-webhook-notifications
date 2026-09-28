# Benji webhook notification system — lean build

A locally runnable webhook sender and operations dashboard for the [Benji senior engineer take-home](https://even-foxglove-53c.notion.site/Sr-Software-Engineer-380b9f151bae81218487d84c42741d17). Endpoints subscribe to event types; publishing an event fans out one signed HTTP delivery per matching enabled endpoint; a worker retries transport failures with bounded exponential backoff; failures keep their full attempt history and can be replayed. The Vue dashboard shows the event fan-out, live status, attempts, and replay.

**Status:** local candidate. Tests pass locally; nothing has been pushed or submitted.

This lean design builds on the specification developed in the earlier Benji attempt, reusing its settled contracts: endpoint-owned subscriptions and fan-out, HMAC-SHA256 signing with a one-time secret, ±300s timestamp window and delivery-id deduplication, 2s/4s three-attempt backoff with replay, server-generated event IDs with a separate sender idempotency key, loopback-only destination policy, and the safe `{code, message}` error envelope. The workflow/version layer is deliberately not carried over; see [design](docs/spec/design.md) and [plan](docs/plan/implementation-plan.md).

## How delivery works

Publishing an event persists it with one logical delivery per matching enabled endpoint, then a worker attempts each delivery over HTTP:

- The first attempt is due immediately; a 2xx response succeeds.
- Transport errors, the 2s request timeout, HTTP 408/429, and 5xx are retried with exponential backoff — 2 seconds before attempt 2, 4 seconds before attempt 3, three attempts per cycle. Other non-2xx responses and redirects fail terminally without retry.
- Every attempt records its start/end, outcome, HTTP status, and a bounded response excerpt. A timed-out attempt is shown as outcome-unknown at the receiver, never as "unprocessed".
- A failed delivery can be replayed: attempts append to the same delivery with the same delivery ID, and the receiver deduplicates side effects by that ID.
- Disabling an endpoint stops new routing and pauses its queued deliveries; resuming restores them without resetting the attempt budget.

No external broker or service is involved: SQLite is the durable queue, and restart recovery sweeps expired leases.

## Requirements

- Python 3.12 via [`uv`](https://docs.astral.sh/uv/) (uv downloads the interpreter if needed)
- Node.js 22 and npm

No database, broker, or hosted service is required. Everything runs on loopback: sender API `127.0.0.1:8000`, demo receiver `127.0.0.1:9000`, dashboard `127.0.0.1:5173`.

## Setup

```sh
uv sync --python 3.12 --group dev
cd frontend && npm ci && npx playwright install chromium && cd ..
```

## Run the demo

Start three terminals from the repository root and keep them running:

```sh
PYTHONPATH=backend uv run --python 3.12 --group dev uvicorn receiver_app.app:app --app-dir receiver --host 127.0.0.1 --port 9000
```

(`PYTHONPATH=backend` lets the receiver verify signatures with the sender's signing module — one authoritative implementation.)

```sh
BENJI_DB_PATH=data/benji.sqlite3 uv run --python 3.12 --group dev uvicorn app.api:app --app-dir backend --host 127.0.0.1 --port 8000
```

```sh
cd frontend && npm run dev
```

Open the dashboard at http://127.0.0.1:5173/, the receiver at http://127.0.0.1:9000/, and the API docs at http://127.0.0.1:8000/docs.

### Reviewer walkthrough

1. **Create endpoints.** In the Endpoints panel, create `Partner CRM` subscribing to `reward_transaction_created` and `member_account_linked`; create `Rewards ledger` subscribing to `reward_transaction_created`. You only name the destination and pick event types — the receiver URL is generated automatically and each creation shows its signing secret **once**: copy it now. Each unacknowledged secret stays on screen until you dismiss it, so creating the next endpoint cannot swallow the previous one.
2. **Connect the secrets.** On the receiver page, paste each one-time secret, choose a response behavior (**Always succeed**, **Fail once, then succeed**, or **Always fail**), and save. Then click **Enable** on each endpoint in the dashboard (new endpoints start disabled). The receiver API also accepts scripted behaviors (`slow`, `slow_fail`, `redirect`, `fail_count:<n>`) used by the automated tests.
3. **Publish an event.** In "Publish test event", keep `reward_transaction_created`, use payload `{"member": "m_1", "points": 10}`, and submit. The event appears in Recent events; select it to see one endpoint node per matching delivery on the journey canvas, with live status pills and animated edges while an attempt is active. The **Enforce schema** switch is on by default for event types that have a registered schema — turn it off to publish an unconventional payload, and hover it when it is disabled to see why.
4. **Watch delivery.** Nodes update without manual refresh. Click an endpoint node to inspect the endpoint URL, state, due time, payload, and the attempt timeline with bounded response excerpts. The receiver page shows each verified request; a `fail_once` path fails attempt 1 and succeeds on the retry (2s later with defaults).

   The selected event and delivery stay in the URL (`?event=evt_…&delivery=dlv_…`), so a view survives a reload and can be shared, and the **Find by ID** box in the header jumps straight to any `evt_…` or `dlv_…` id you paste from a log.
5. **Deduplicate and conflict.** The submission key rotates automatically after each accepted event. To demonstrate deduplication, paste the previous key back into **Submission key** and publish the same payload — the dashboard reports `Already accepted` with the original event ID and creates no new delivery. Change the payload while keeping that key and publish to see the `409` conflict notice.
6. **Replay.** Set a path to `always_fail`, publish, and wait for the three-attempt cycle to end in `Failed`. Open the branch and click **Replay** — attempts append to the same delivery and the receiver sees the same delivery ID.
7. **Disable/resume.** Disable an endpoint: new events stop routing to it and its queued deliveries pause. Resume restores them. A disabled endpoint blocks replay until resumed.

A quick scripted version of steps 1–3 (after the services are running):

```sh
python3 scripts/seed_demo.py
```

It creates both endpoints, connects their secrets to the receiver (`success` and `fail_once`), and publishes one shared event. It does not reset existing data.

### Event types and payload schemas

Event types are open: any name matching `[A-Za-z0-9_.-]{1,64}` can be published and subscribed to, and the composer's type list plus the **Find by ID**/filter facets pick new types up automatically. A type becomes stricter only when a payload schema is registered for it:

- `GET /api/event-types` lists the registered types with a generated JSON Schema; the composer's dropdown and its "expected: …" hint read from it.
- Registered today: `reward_transaction_created` (`member: string`, `points: integer ≥ 0`) and `member_account_linked` (`member: string`); extra fields are rejected.
- Enforcement is per submission: the dashboard sends `enforce_schema: true` when the switch is on, and `POST /api/events` defaults the flag to `false`, so existing API clients and unregistered types keep today's structural checks (JSON object or array, 32 KiB, nesting depth).
- A rejected payload returns `400 validation_error` with field paths only — no values, no event, and the submission key is not consumed.
- To add a contract, add a pydantic model and a registry entry in `backend/app/event_schemas.py`; the type then appears in the dashboard with its expected shape.

### Delivery trend

The **Delivery trend** card answers "how is this event type doing?" for one type at a time: pick the type and a window (6 hours, 24 hours, or 7 days) to see delivery volume, success rate, failures, average attempts per delivery, and average attempt duration, plus a bar per time bucket with a tooltip for the exact counts. `GET /api/event-types/{type}/stats?hours=24&buckets=24` backs it. A delivery is counted in the bucket where it was created and under its current status, so the newest bucket can still change while a delivery retries or is replayed.

## Tests

```sh
uv run pytest -q                       # backend: units + integration against a real local receiver
cd frontend && npm test && npm run build
python3 scripts/run_e2e.py             # browser E2E: boots all three services on free ports
```

The backend suite covers signature verification and tamper rejection, URL policy, fan-out and deduplication (including a concurrent same-key race), retry classification with observed backoff, timeout handling, redirect non-following, replay with attempt history, disable/resume including mid-flight attempts, expired-lease recovery, concurrency limits, and a full reviewer journey. Frontend tests cover API error mapping, the one-time secret banner, composer deduplication/conflict/uncertain states, polling staleness, fan-out rendering, attempt labels, and replay gating. The Playwright suite (chromium, serial) drives the real browser against all three services: endpoint lifecycle and the one-time secret, fan-out with deduplicated resubmission, a fail-once retry reaching Delivered without manual refresh, verified attempt history with replay on the same delivery, tampered-signature rejection at the receiver, disable and no-receiver routing, and the empty/pending/stale UI states.

## Scope and safety

This is a deliberately local, single-customer demo with no login. Destination URLs are restricted to the configured receiver origin and `/webhooks/` paths and are revalidated at dispatch; redirects are never followed. Secrets are shown once and never returned again or logged. Payloads and response excerpts render as escaped text only. The receiver keeps its configuration and dedupe memory in process, so a receiver restart requires reconfiguring it. Production gaps — authentication, public HTTPS destination policy with DNS validation, secret rotation, retention, rate limits, horizontal dispatch — are documented in the [design's cuts section](docs/spec/design.md).

## Project records

- [Design specification](docs/spec/design.md) · [implementation plan](docs/plan/implementation-plan.md)
- [Decisions and trade-offs](docs/process/decisions-and-tradeoffs.md) · [AI usage note](docs/process/ai-usage.md) · [focused work log](docs/process/worklog.md)
- [Engineering instructions](AGENTS.md)

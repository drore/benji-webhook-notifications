# Benji webhook notification system — lean build

A locally runnable webhook sender and operations dashboard for the [Benji senior engineer take-home](https://even-foxglove-53c.notion.site/Sr-Software-Engineer-380b9f151bae81218487d84c42741d17). Endpoints subscribe to event types; publishing an event fans out one signed HTTP delivery per matching enabled endpoint; a worker retries transport failures with bounded exponential backoff; failures keep their full attempt history and can be replayed. The Vue dashboard shows the event fan-out, live status, attempts, and replay.

**Status:** local candidate. Tests pass locally; nothing has been pushed or submitted.

This lean design builds on the specification developed in the earlier Benji attempt, reusing its settled contracts: endpoint-owned subscriptions and fan-out, HMAC-SHA256 signing with a one-time secret, ±300s timestamp window and delivery-id deduplication, 2s/4s three-attempt backoff with replay, server-generated event IDs with a separate sender idempotency key, loopback-only destination policy, and the safe `{code, message}` error envelope. The workflow/version layer is deliberately not carried over; see [design](docs/spec/design.md) and [plan](docs/plan/implementation-plan.md).

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

1. **Create endpoints.** In the Endpoints panel, create `Partner CRM` with URL `http://127.0.0.1:9000/webhooks/crm` subscribing to `reward_transaction_created` and `member_account_linked`; create `Rewards ledger` at `http://127.0.0.1:9000/webhooks/ledger` subscribing to `reward_transaction_created`. Each creation shows its signing secret **once** — copy it now.
2. **Configure the receiver.** On the receiver page, save each one-time secret with its path slug (`crm`, `ledger`) and a behavior: `success`, `fail_once`, or `always_fail`. Then click **Enable** on each endpoint in the dashboard (new endpoints start disabled).
3. **Publish an event.** In "Publish a test event", keep `reward_transaction_created`, use payload `{"member": "m_1", "points": 10}`, and submit. The event appears in Recent events; select it to see one branch per matching endpoint with live status.
4. **Watch delivery.** Branches update without manual refresh. Click a branch to inspect the endpoint URL, state, due time, payload, and the attempt timeline with bounded response excerpts. The receiver page shows each verified request; a `fail_once` path fails attempt 1 and succeeds on the retry (2s later with defaults).
5. **Deduplicate.** Submit the same payload again after changing only the key **back** to the previous value: use the retained submission key and press "Check or resend submission" — the dashboard reports `Already accepted` with the original event ID and no new delivery. Editing the key and resubmitting the same content creates a new event.
6. **Replay.** Set a path to `always_fail`, publish, and wait for the three-attempt cycle to end in `Failed`. Open the branch and click **Replay** — attempts append to the same delivery and the receiver sees the same delivery ID.
7. **Disable/resume.** Disable an endpoint: new events stop routing to it and its queued deliveries pause. Resume restores them. A disabled endpoint blocks replay until resumed.

A quick scripted version of steps 1 and 3 (after the services are running):

```sh
python3 scripts/seed_demo.py
```

It creates both endpoints, enables them, prints the secrets for the receiver form, and publishes one shared event. It does not reset existing data.

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
- [AI usage note](docs/process/ai-usage.md) · [focused work log](docs/process/worklog.md)
- [Engineering instructions](AGENTS.md)

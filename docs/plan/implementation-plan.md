# Lean Webhook Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Note for reviewers:** the step checkboxes below are the plan as it was written, not a progress tracker — every task was completed and the evidence is in [Execution Evidence](#execution-evidence-2026-09-27-branch-lean-webhook-build) at the end of this file.

**Goal:** Build a locally runnable webhook sender with an operations dashboard: endpoints with event-type subscriptions, signed delivery with bounded exponential retries, replay, deduplication, and live attempt inspection.

**Architecture:** One FastAPI process serves the API and runs an asyncio delivery worker in its lifespan. SQLite (WAL) is the durable queue: event acceptance persists the event and its deliveries in one transaction; the worker claims due deliveries with a lease, signs and posts via httpx, and records attempts. A separate tiny FastAPI demo receiver verifies signatures and supports success/fail-once/always-fail/slow behaviors. A Vue 3 + TypeScript SPA (Vite, polling every 2s) is the dashboard, split into API client, state composables, and presentational components.

**Tech Stack:** Python 3.12 (uv-managed), FastAPI, uvicorn, httpx, pydantic, SQLite; Vue 3, TypeScript, Vite, Vitest; pytest (+ anyio's bundled pytest plugin).

**Spec:** `docs/spec/design.md` (frozen; read it with this plan)

## Global Constraints

- Single fixed customer, loopback only, no login, no external infrastructure (spec CON-02, SEC-06).
- One logical delivery per `(event_id, endpoint_id)`; unique constraint enforced in SQLite (FR-01, AC-04).
- Retry delays 2s then 4s, max 3 attempts per cycle, measured from prior attempt completion; 2s request timeout; 10s claim lease; claim tick 0.5s; global concurrency 4 and one in-flight attempt per endpoint (FR-04, FR-05). Delays, timeout, lease, and tick MUST be configurable via env for tests.
- Initial attempt due immediately. Retryable: transport errors, timeout, 408, 429, 5xx. Terminal: any other non-2xx and 3xx; redirects never followed (FR-04).
- Delivery statuses: `pending`, `in_progress`, `retrying`, `paused`, `succeeded`, `failed` (spec section 3).
- Signature: `X-Webhook-Signature: v1=<hex HMAC-SHA256>` over UTF-8 `{timestamp}.{delivery_id}.` + raw body; headers `X-Webhook-Delivery-Id`, `X-Webhook-Timestamp`; receiver window ±300s, constant-time compare, dedupe by delivery id (FR-07).
- URL policy: exactly the configured receiver origin (default `http://127.0.0.1:9000`), path `/webhooks/{slug}` with slug matching `^[a-z0-9-]{1,32}$`, no credentials/query/fragment; revalidate at dispatch; reject others (FR-08, AC-12).
- Idempotency key 1–128 and event type 1–64 chars from `[A-Za-z0-9_.-]`, case-sensitive; payload any JSON object/array ≤ 32 KiB canonical UTF-8 (FR-09). Canonical form: `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
- Errors: `{code, message}` with `validation_error` 400, `idempotency_conflict` 409, `replay_unavailable` 409, `not_found` 404, `internal_error` 500; never include secrets, payloads, or traces (FR-09, SEC-05).
- Secrets: `secrets.token_bytes(32)` shown once as `whsec_` + unpadded base64url; never logged or returned after creation; constant-time comparison (SEC-03).
- Timestamps stored in SQLite as REAL Unix epoch seconds (UTC); API serializes ISO 8601 UTC strings.
- Payload/response text renders as escaped text/JSON only, never HTML; excerpts bounded to 1 KiB (SEC-04).
- Pin dependencies; do not add packages beyond the Tech Stack without approval. No external fonts, CDNs, or telemetry (SEC-08).
- Commit after every task; **never push**; `docs/spec/design.md` changes require Dror's explicit approval.

## Review Focus

Inputs/failure modes implied but outside the main tests; each is pinned to a task below:

1. Malformed JSON bodies, non-UTF-8 bytes, or wrong JSON top-level type → 400 `validation_error`, never 500 (Task 5).
2. Payload exactly at the 32 KiB boundary and one byte over (Task 5).
3. URL parser edge cases: credentials, query, fragment, uppercase host, `localhost` vs `127.0.0.1`, port mismatch (Task 3).
4. Clock-skew boundary exactly ±300s and a 3xx redirect response (Tasks 3, 6).
5. Concurrent disable mid-flight and concurrent replay of one delivery (Tasks 9, 10).

## Shared Interfaces

Store functions (`backend/app/store.py`) — every task must use exactly these names:
`create_endpoint(conn, name, url, event_types, receiver_origin) -> tuple[EndpointRecord, str]`, `list_endpoints(conn) -> list[EndpointRecord]`, `set_endpoint_enabled(conn, endpoint_id, enabled) -> EndpointRecord | None`, `accept_event(conn, idempotency_key, event_type, payload) -> Acceptance`, `list_events(conn, limit) -> list[EventSummary]`, `get_event(conn, event_id) -> EventDetail | None`, `get_delivery(conn, delivery_id) -> DeliveryDetail | None`, `claim_due_delivery(conn, now, excluded_endpoint_ids) -> ClaimedDelivery | None`, `complete_attempt(conn, delivery_id, outcome, http_status, response_excerpt, next_due_at, terminal_status) -> None`, `sweep_expired_leases(conn, now) -> int`, `replay_delivery(conn, delivery_id, now) -> ReplayResult`, `overview(conn) -> Overview`.

API JSON shapes (frontend tasks consume these verbatim):
- Endpoint: `{id, name, url, event_types: string[], enabled: boolean, created_at}`; create returns `{endpoint, secret}`.
- Submit: request `{idempotency_key, type, payload}`; `201`/`200` `{event_id, deduplicated}`; `409` conflict.
- Event summary: `{id, type, created_at, deliveries: {pending, in_progress, retrying, paused, succeeded, failed}}`.
- Event detail: `{id, type, payload, created_at, deliveries: [{id, endpoint_id, endpoint_name, endpoint_url, status, due_at, attempts_count}]}`.
- Delivery detail: `{id, event_id, event: {id, type, payload, created_at}, endpoint: {id, name, url, enabled}, status, due_at, cycle_attempts, attempts: [{id, number, started_at, finished_at, outcome, http_status, response_excerpt}]}`.
- Overview: `{failed_count, retrying_count, earliest_due_at, latest_event: {id, type, created_at} | null}`.
- Replay: `202` `{delivery_id, status: "pending"}`.

Frontend composables (`frontend/src/state/*.ts`), each returns refs + actions with this uniform polling surface: `{loading, stale, lastUpdatedAt, error, load(), startPolling(intervalMs = 2000), stopPolling()}`:
`createEndpointsState(api)`, `createEventsState(api)`, `createComposerState(api)`, `createDeliveryState(api)`, `createOverviewState(api)`.

HTTP client (`frontend/src/api/client.ts`): `createDashboardApi(base = "/api")` returning `{getOverview, listEvents(limit?), getEvent(id), getDelivery(id), listEndpoints, createEndpoint(input), setEndpointEnabled(id, enabled), submitEvent(input), replayDelivery(id), getHealth()}`; rejects with `ApiError {code, message, httpStatus | null}` (`httpStatus === null` means transport failure).

---

### Task 1: Backend skeleton, config, schema, health, and project records

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `AGENTS.md`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/api.py`, `tests/__init__.py`, `tests/conftest.py`, `tests/test_skeleton.py`, `docs/process/ai-usage.md`, `docs/process/worklog.md`

**Interfaces:**
- Produces: `app.config.Settings` + `get_settings() -> Settings`; `app.db.connect(path: str | Path) -> sqlite3.Connection`, `app.db.init_schema(conn) -> None`; `app.api.create_app(settings: Settings | None = None) -> FastAPI`, module-level `app`.

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "benji-webhook-demo"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["fastapi>=0.115", "uvicorn[standard]>=0.30", "httpx>=0.27", "pydantic>=2.8"]

[dependency-groups]
dev = ["pytest>=8.2", "anyio>=4.4"]
```

- [ ] **Step 2: Create `.gitignore`** with `.venv/`, `__pycache__/`, `*.pyc`, `data/`, `node_modules/`, `frontend/dist/`, `frontend/test-results/`, `.DS_Store`.

- [ ] **Step 3: Adapt `AGENTS.md`** from `/Users/drore/.codex/worktrees/benji-first-rope/benji-task/AGENTS.md`: keep its six principle sections (start with the contract; small complete slices; design for a human maintainer with SSOT; security and remote effects first-class; AI as checked collaborator; verify and hand off honestly), rewrite repo-specific specifics to: spec at `docs/spec/design.md` (frozen without Dror's approval), plan at `docs/plan/implementation-plan.md`, run/test commands from the README, no push without approval, loopback-only security boundaries.

- [ ] **Step 4: Write the failing test `tests/test_skeleton.py`**

```python
import sqlite3
from app.config import Settings
from app.db import connect, init_schema
from app.api import create_app
from fastapi.testclient import TestClient

def test_settings_defaults():
    s = Settings()
    assert s.receiver_origin == "http://127.0.0.1:9000"
    assert s.retry_delays == (2.0, 4.0)
    assert s.request_timeout == 2.0 and s.claim_lease_seconds == 10.0
    assert s.max_concurrency == 4 and s.tick_interval == 0.5

def test_schema_tables(tmp_path):
    conn = connect(tmp_path / "t.sqlite3")
    init_schema(conn)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"endpoints", "events", "deliveries", "attempts"} <= names

def test_health(tmp_path):
    s = Settings(db_path=str(tmp_path / "t.sqlite3"), worker_enabled=False)
    with TestClient(create_app(s)) as client:
        r = client.get("/api/health")
        assert r.status_code == 200 and r.json()["status"] == "ok"

def test_not_found_envelope(tmp_path):
    s = Settings(db_path=str(tmp_path / "t.sqlite3"), worker_enabled=False)
    with TestClient(create_app(s)) as client:
        r = client.get("/api/endpoints/nope")
        assert r.status_code == 404 and r.json()["code"] == "not_found"
```

- [ ] **Step 5: Run `uv sync --python 3.12 --group dev && uv run pytest tests/test_skeleton.py -q`** — expected FAIL (modules missing).

- [ ] **Step 6: Implement config and db**

`Settings` is a pydantic-settings-free implementation: subclass `pydantic.BaseModel`, read `os.environ` in `get_settings()`; env keys `BENJI_DB_PATH` (default `data/benji.sqlite3`), `BENJI_RECEIVER_ORIGIN`, `BENJI_RETRY_DELAYS` (comma-separated, default `2,4`), `BENJI_REQUEST_TIMEOUT`, `BENJI_CLAIM_LEASE_SECONDS`, `BENJI_TICK_INTERVAL`, `BENJI_MAX_CONCURRENCY`, `BENJI_WORKER_ENABLED`. `Settings(db_path=..., ...)` must accept direct kwargs for tests. Validate origin: scheme `http`, host in `{127.0.0.1}` (reject `localhost`), valid port.

`db.connect`: `sqlite3.connect(path, isolation_level=None)` with `row_factory = sqlite3.Row`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`. Create the parent directory when missing.
`db.init_schema` executes exactly this DDL (timestamps REAL epoch seconds):

```sql
CREATE TABLE IF NOT EXISTS endpoints (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
  event_types TEXT NOT NULL, secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  payload TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
  status TEXT NOT NULL, due_at REAL, cycle_attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at REAL, created_at REAL NOT NULL, updated_at REAL NOT NULL,
  UNIQUE(event_id, endpoint_id));
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  number INTEGER NOT NULL, started_at REAL NOT NULL, finished_at REAL,
  outcome TEXT, http_status INTEGER, response_excerpt TEXT,
  UNIQUE(delivery_id, number));
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON deliveries(status, due_at);
```

- [ ] **Step 7: Implement `create_app`** with lifespan calling `connect` + `init_schema` (worker start comes in Task 7 behind `settings.worker_enabled`), `GET /api/health` → `{"status": "ok"}`, and exception handlers for `ApiError` (defined here: `app.models.ApiError(code, message, status_code)`) plus `RequestValidationError` → 400 `validation_error` and `Exception` → 500 `internal_error`, all returning `{code, message}`. Also write `tests/conftest.py` with fixtures used from here on: `settings(tmp_path)` (temp DB, `worker_enabled=False`), `db_conn` (connected + schema-initialized, closed on teardown), and `client` (`TestClient` over `create_app(settings)` entered as a context manager so lifespan runs).

- [ ] **Step 8: Create process records.** `ai-usage.md`: short note that the work is AI-assisted, which tools were used, and where evidence lives. `worklog.md`: focused-session timing table (CON-01) starting now.

- [ ] **Step 9: Run `uv run pytest -q`** — expected PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add pyproject.toml uv.lock .gitignore AGENTS.md backend tests docs/process
git commit -m "Add backend skeleton, schema, health endpoint, and process records"
```

### Task 2: Frontend skeleton, API client, Vitest

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/App.vue`, `frontend/src/style.css`, `frontend/src/api/client.ts`, `frontend/tests/client.test.ts`

**Interfaces:**
- Consumes: API shapes from Shared Interfaces.
- Produces: `createDashboardApi(base?: string)` and `ApiError` exactly as in Shared Interfaces; Vite dev server proxies `/api` → `http://127.0.0.1:8000`.

- [ ] **Step 1: Write the failing test `frontend/tests/client.test.ts`**

```ts
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
```

- [ ] **Step 2: Run `cd frontend && npm install && npm test`** — expected FAIL (client missing).

- [ ] **Step 3: Implement** `client.ts` (fetch wrapper; `ApiError extends Error` with constructor `ApiError(code: string, message: string, httpStatus: number | null)`; JSON envelope parsing; transport errors → `httpStatus: null`, code `"transport_error"`), `App.vue` (placeholder shell showing `/api/health` status), `style.css` (CSS variables: `--navy:#071437`, `--purple:#9900FF`, status colors, system font stack), Vite config (Vue plugin, `server.proxy["/api"] = "http://127.0.0.1:8000"`), Vitest config (`environment: "jsdom"`, setup for `@vue/test-utils`).

- [ ] **Step 4: Run `npm test`** — expected PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Add Vue3/TS skeleton, API client, and Vitest setup"
```

### Task 3: Signing and destination policy units

**Files:**
- Create: `backend/app/signing.py`, `backend/app/policy.py`, `tests/test_signing.py`, `tests/test_policy.py`

**Interfaces:**
- Produces: `signing.generate_secret() -> str`; `signing.sign(secret: str, delivery_id: str, timestamp: int, body: bytes) -> str` (hex); `signing.signature_header(secret, delivery_id, timestamp, body) -> str` (`v1=<hex>`); `signing.verify(secret, delivery_id, timestamp_header: str, signature_header: str, body: bytes, now: int) -> bool`; `policy.PolicyError(ValueError)` with `.code = "validation_error"`; `policy.validate_url(url: str, receiver_origin: str) -> str` (returns slug).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_signing.py
from app import signing

def test_secret_shape_and_signature():
    secret = signing.generate_secret()
    assert secret.startswith("whsec_") and len(secret) == 6 + 43
    body = b'{"a":1}'
    header = signing.signature_header(secret, "dlv_abc", 1700000000, body)
    assert header.startswith("v1=") and len(header) == 3 + 64
    assert signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1700000000)

def test_verify_rejects_tampering_and_skew():
    secret = signing.generate_secret()
    body, header = b'{"a":1}', None
    header = signing.signature_header(secret, "dlv_abc", 1700000000, body)
    assert not signing.verify(secret, "dlv_abc", "1700000000", header, b'{"a":2}', now=1700000000)
    assert not signing.verify(secret, "dlv_other", "1700000000", header, body, now=1700000000)
    assert not signing.verify(secret, "dlv_abc", "1700000000", "v1=00", body, now=1700000000)
    assert signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1700000300)   # boundary passes
    assert not signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1700000301)  # +301 fails
    assert signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1699999700)   # -300 passes
    assert not signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1699999699)  # -301 fails
    assert not signing.verify(secret, "dlv_abc", "not-a-time", header, body, now=1700000000)
```

```python
# tests/test_policy.py
import pytest
from app.policy import PolicyError, validate_url

ORIGIN = "http://127.0.0.1:9000"

def test_accepts_only_exact_origin_webhook_paths():
    assert validate_url("http://127.0.0.1:9000/webhooks/crm", ORIGIN) == "crm"
    assert validate_url("http://127.0.0.1:9000/webhooks/ledger-2", ORIGIN) == "ledger-2"

@pytest.mark.parametrize("url", [
    "https://127.0.0.1:9000/webhooks/crm", "http://localhost:9000/webhooks/crm",
    "http://127.0.0.1:9001/webhooks/crm", "http://127.0.0.1:9000/admin",
    "http://127.0.0.1:9000/Webhooks/crm", "http://127.0.0.1:9000/webhooks/UPPER",
    "http://127.0.0.1:9000/webhooks/crm?x=1",
    "http://127.0.0.1:9000/webhooks/crm#f", "http://user:pw@127.0.0.1:9000/webhooks/crm",
    "http://example.com/webhooks/crm", "ftp://127.0.0.1:9000/webhooks/crm",
    "http://127.0.0.1:9000/webhooks/", "http://127.0.0.1:9000/webhooks/a/b",
])
def test_rejects_everything_else(url):
    with pytest.raises(PolicyError):
        validate_url(url, ORIGIN)
```

- [ ] **Step 2: Run `uv run pytest tests/test_signing.py tests/test_policy.py -q`** — expected FAIL (modules missing).

- [ ] **Step 3: Implement.** `generate_secret`: `"whsec_" + base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()`. Signed message: `f"{timestamp}.{delivery_id}.".encode() + body`. `verify`: parse `v1=` prefix and int timestamp, reject on parse errors, check `abs(now - ts) <= 300`, `hmac.compare_digest`. `validate_url`: `urllib.parse.urlsplit`, enforce scheme/hostname/port exactly equal to parsed origin, no username/password/query/fragment, path starts `/webhooks/` with remaining segment matching `^[a-z0-9-]{1,32}$` and containing no extra `/`.

- [ ] **Step 4: Run the same tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/signing.py backend/app/policy.py tests/test_signing.py tests/test_policy.py
git commit -m "Add signature and destination-policy units"
```

### Task 4: Endpoints API, store, and disable/resume semantics

**Files:**
- Create: `backend/app/models.py`, `backend/app/store.py`, `tests/test_endpoints_api.py`, `tests/test_disable.py`
- Modify: `backend/app/api.py`

**Interfaces:**
- Consumes: `policy.validate_url`, `signing.generate_secret`, `app.db.connect`.
- Produces: store functions `create_endpoint`, `list_endpoints`, `set_endpoint_enabled` (exact signatures in Shared Interfaces); `EndpointRecord` dataclass `{id, name, url, event_types, secret, enabled, created_at}`; routes `POST /api/endpoints`, `GET /api/endpoints`, `POST /api/endpoints/{id}/enable|disable`; ids `ep_` + 12 hex chars.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_endpoints_api.py
def test_create_returns_secret_once(client):
    r = client.post("/api/endpoints", json={"name": "CRM", "url": "http://127.0.0.1:9000/webhooks/crm",
                                            "event_types": ["reward_transaction_created"]})
    assert r.status_code == 201
    body = r.json()
    assert body["secret"].startswith("whsec_") and body["endpoint"]["enabled"] is False
    listed = client.get("/api/endpoints").json()["items"]
    assert len(listed) == 1 and "secret" not in listed[0]

def test_create_validates_input(client):
    bad = client.post("/api/endpoints", json={"name": "", "url": "http://example.com/webhooks/x", "event_types": []})
    assert bad.status_code == 400 and bad.json()["code"] == "validation_error"
    for event_type in ["", "bad type", "x" * 65]:
        r = client.post("/api/endpoints", json={"name": "n", "url": "http://127.0.0.1:9000/webhooks/x",
                                                "event_types": [event_type]})
        assert r.status_code == 400

def test_enable_disable_roundtrip(client):
    ep = client.post("/api/endpoints", json={"name": "CRM", "url": "http://127.0.0.1:9000/webhooks/crm",
                                             "event_types": ["a"]}).json()["endpoint"]
    assert client.post(f"/api/endpoints/{ep['id']}/enable").json()["enabled"] is True
    assert client.post(f"/api/endpoints/{ep['id']}/disable").json()["enabled"] is False
    assert client.post("/api/endpoints/ep_missing/enable").status_code == 404
```

```python
# tests/test_disable.py — store-level pause/restore (worker interplay is Task 9)
import time

def test_disable_pauses_pending_and_retrying_and_resume_restores_due_times(db_conn):
    from app import store
    ep, _ = store.create_endpoint(db_conn, "CRM", "http://127.0.0.1:9000/webhooks/crm", ["a"], "http://127.0.0.1:9000")
    store.set_endpoint_enabled(db_conn, ep.id, True)
    now = time.time()
    db_conn.execute("INSERT INTO events VALUES ('evt_1','k1','a','{}',?)", (now,))
    db_conn.execute("INSERT INTO deliveries VALUES ('dlv_1','evt_1',?,'pending',?,0,NULL,?,?)",
                    (ep.id, now, now, now))
    assert store.list_events(db_conn, 10)[0].deliveries["pending"] == 1
    store.set_endpoint_enabled(db_conn, ep.id, False)
    assert store.list_events(db_conn, 10)[0].deliveries["paused"] == 1
    store.set_endpoint_enabled(db_conn, ep.id, True)
    assert store.list_events(db_conn, 10)[0].deliveries["pending"] == 1
```

- [ ] **Step 2: Run `uv run pytest tests/test_endpoints_api.py tests/test_disable.py -q`** — expected FAIL.

- [ ] **Step 3: Implement `models.py`** (pydantic request models `EndpointCreate{name, url, event_types}`, response builders, `ApiError`, and the canonicalization helper `canonical_json(value) -> str`) and **`store.py`**. `create_endpoint` validates name (1–100 chars), URL via policy, event types via the shared `validate_type` regex helper, generates `ep_<secrets.token_hex(6)>`, stores subscriptions as JSON text, `enabled=0`. `set_endpoint_enabled(conn, id, False)`: single transaction — set `enabled=0`; `UPDATE deliveries SET status='paused', updated_at=? WHERE endpoint_id=? AND status IN ('pending','retrying')`; resume: `enabled=1`, `UPDATE deliveries SET status='pending' WHERE endpoint_id=? AND status='paused' AND (due_at IS NULL OR due_at <= ?)` and `status='retrying'` for future due times (due times retained as-is). Return `None` for unknown id. Add `app/db.py` helper `transaction(conn)` context manager (BEGIN/COMMIT/ROLLBACK). Add routes to `api.py`.

- [ ] **Step 4: Run the same tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/store.py backend/app/api.py tests/test_endpoints_api.py tests/test_disable.py
git commit -m "Add endpoints API with one-time secret and disable/resume pause semantics"
```

### Task 5: Event intake — identity, dedupe, fan-out, bounds

**Files:**
- Modify: `backend/app/store.py`, `backend/app/models.py`, `backend/app/api.py`
- Create: `tests/test_events_api.py`

**Interfaces:**
- Produces: `store.accept_event(conn, idempotency_key, event_type, payload) -> Acceptance(status: Literal["created", "deduplicated", "conflict"], event_id: str | None)`; `store.list_events`, `store.get_event`; route `POST /api/events` and `GET /api/events?limit=`; event ids `evt_` + 12 hex, delivery ids `dlv_` + 12 hex.

- [ ] **Step 1: Write the failing tests**

```python
def test_fan_out_shared_single_and_none(client):
    for slug, types in [("crm", ["reward_transaction_created", "member_account_linked"]),
                        ("ledger", ["reward_transaction_created"])]:
        ep = client.post("/api/endpoints", json={"name": slug, "url": f"http://127.0.0.1:9000/webhooks/{slug}",
                                                 "event_types": types}).json()["endpoint"]
        client.post(f"/api/endpoints/{ep['id']}/enable")
    shared = client.post("/api/events", json={"idempotency_key": "k1", "type": "reward_transaction_created",
                                              "payload": {"amount": 5}})
    assert shared.status_code == 201 and shared.json()["deduplicated"] is False
    detail = client.get(f"/api/events/{shared.json()['event_id']}").json()
    assert {d["endpoint_name"] for d in detail["deliveries"]} == {"crm", "ledger"}
    one = client.post("/api/events", json={"idempotency_key": "k2", "type": "member_account_linked", "payload": {}}).json()
    assert len(client.get(f"/api/events/{one['event_id']}").json()["deliveries"]) == 1
    none = client.post("/api/events", json={"idempotency_key": "k3", "type": "campaign_updated", "payload": {}}).json()
    assert client.get(f"/api/events/{none['event_id']}").json()["deliveries"] == []

def test_concurrent_same_key_creates_one_event_and_deliveries(tmp_path):
    from app.api import create_app
    from app.config import Settings
    from fastapi.testclient import TestClient
    from concurrent.futures import ThreadPoolExecutor
    s = Settings(db_path=str(tmp_path / "c.sqlite3"), worker_enabled=False)
    with TestClient(create_app(s)) as client:
        ep = client.post("/api/endpoints", json={"name": "crm", "url": "http://127.0.0.1:9000/webhooks/crm",
                                                 "event_types": ["a"]}).json()["endpoint"]
        client.post(f"/api/endpoints/{ep['id']}/enable")
        body = {"idempotency_key": "race", "type": "a", "payload": {"x": 1}}
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda _: client.post("/api/events", json=body), range(8)))
        assert sorted(r.status_code for r in responses) == [200] * 7 + [201]
        ids = {r.json()["event_id"] for r in responses}
        assert len(ids) == 1
        detail = client.get(f"/api/events/{ids.pop()}").json()
        assert len(detail["deliveries"]) == 1

def test_dedupe_conflict_and_key_order(client):
    first = client.post("/api/events", json={"idempotency_key": "k", "type": "a", "payload": {"x": 1, "y": [2]}})
    again = client.post("/api/events", json={"idempotency_key": "k", "type": "a", "payload": {"y": [2], "x": 1}})
    assert again.status_code == 200 and again.json()["event_id"] == first.json()["event_id"]
    assert again.json()["deduplicated"] is True
    conflict = client.post("/api/events", json={"idempotency_key": "k", "type": "a", "payload": {"x": 2}})
    assert conflict.status_code == 409 and conflict.json()["code"] == "idempotency_conflict"
    fresh = client.post("/api/events", json={"idempotency_key": "k-new", "type": "a", "payload": {"x": 2}})
    assert fresh.status_code == 201 and fresh.json()["event_id"] != first.json()["event_id"]

def test_intake_bounds_and_malformed(client):
    assert client.post("/api/events", content=b"{not json",
                       headers={"content-type": "application/json"}).status_code == 400
    assert client.post("/api/events", json={"idempotency_key": "k", "type": "a", "payload": "scalar"}).status_code == 400
    assert client.post("/api/events", json={"idempotency_key": "x" * 129, "type": "a", "payload": {}}).status_code == 400
    at_limit = {"k": "a" * (32 * 1024 - 9)}
    r = client.post("/api/events", json={"idempotency_key": "k-size", "type": "a", "payload": at_limit})
    assert r.status_code == 201                       # exactly 32768 canonical bytes
    over = {"k": "a" * (32 * 1024 - 8)}
    assert client.post("/api/events", json={"idempotency_key": "k-over", "type": "a", "payload": over}).status_code == 400

def test_disabled_endpoint_excluded_from_new_fan_out(client):
    ep = client.post("/api/endpoints", json={"name": "crm", "url": "http://127.0.0.1:9000/webhooks/crm",
                                             "event_types": ["a"]}).json()["endpoint"]   # never enabled
    assert client.post("/api/events", json={"idempotency_key": "k", "type": "a", "payload": {}}).status_code == 201
    assert client.get("/api/events?limit=1").json()["items"][0]["deliveries"]["pending"] == 0
```

- [ ] **Step 2: Run `uv run pytest tests/test_events_api.py -q`** — expected FAIL.

- [ ] **Step 3: Implement.** `accept_event`: validate key/type with the shared regex, `canonical_json`, encode UTF-8, enforce ≤ 32768 bytes; one transaction: look up `events` by key — if found, compare `type` and `payload` text: equal → `deduplicated`, else `conflict`; else insert event, select matching enabled endpoints (`json_each(endpoints.event_types)` membership), insert one delivery per match with status `pending`, `due_at = now` (first attempt immediate), `cycle_attempts = 0`. Catch `sqlite3.IntegrityError` on the insert (concurrent same-key winner) and re-read the row to return `deduplicated`. Routes: JSON parse error → 400 (RequestValidationError handler covers this); `GET /api/events` returns summaries with per-status counts; `GET /api/events/{id}` returns detail. Use `/api/events` request model `{idempotency_key: str, type: str, payload: Any}`.

- [ ] **Step 4: Run the same tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/store.py backend/app/models.py backend/app/api.py tests/test_events_api.py
git commit -m "Add event intake with server identity, dedupe, fan-out, and bounds"
```

### Task 6: Demo receiver app

**Files:**
- Create: `receiver/receiver_app/__init__.py`, `receiver/receiver_app/app.py`, `tests/test_receiver.py`

**Interfaces:**
- Produces: `receiver_app.app.create_receiver_app() -> FastAPI`, module `app`; state in `ReceiverState` with `config: dict[str, ReceiverConfig{slug, secret, behavior, slow_seconds, seen: set[str], failures: dict[str, int]}]`, `requests: list[dict]`; routes `GET /` (HTML page: config form + request log, no external assets), `POST /api/config` (`{slug, secret, behavior, slow_seconds?}`), `POST /api/reset`, `GET /api/requests`, `POST /webhooks/{slug}`; behaviors `success`, `fail_once`, `always_fail`, `slow`, `slow_fail`, `redirect`, `fail_count:<n>` (fail the first n verified requests per delivery then succeed); request log entries `{delivery_id, verified, duplicate, received_at, body}`.

- [ ] **Step 1: Write the failing tests** (ASGI transport; also covers Review Focus 4 redirect/clock)

```python
import time
import httpx
from receiver_app.app import create_receiver_app

async def _post(receiver, slug, body, secret, delivery_id, ts, *, sig=None):
    from app.signing import signature_header
    return await httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r").post(
        f"/webhooks/{slug}", content=body,
        headers={"X-Webhook-Delivery-Id": delivery_id, "X-Webhook-Timestamp": str(ts),
                 "X-Webhook-Signature": sig or signature_header(secret, delivery_id, ts, body)})

def test_receiver_verifies_dedupes_and_behaves():
    import anyio
    receiver = create_receiver_app()
    async def flow():
        ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r")
        await ac.post("/api/config", json={"slug": "crm", "secret": "whsec_test", "behavior": "fail_once"})
        ts = int(time.time()); body = b'{"a":1}'
        first = await _post(receiver, "crm", body, "whsec_test", "dlv_1", ts)
        assert first.status_code == 500
        second = await _post(receiver, "crm", body, "whsec_test", "dlv_1", ts)
        assert second.status_code == 200 and second.json()["duplicate"] is False
        again = await _post(receiver, "crm", body, "whsec_test", "dlv_1", ts)
        assert again.status_code == 200 and again.json()["duplicate"] is True
        bad = await _post(receiver, "crm", b'{"a":2}', "whsec_test", "dlv_1", ts)
        assert bad.status_code == 401
        stale = await _post(receiver, "crm", body, "whsec_test", "dlv_2", ts - 301)
        assert stale.status_code == 401
        log = (await ac.get("/api/requests")).json()["items"]
        assert len(log) == 4 and [e["verified"] for e in log] == [True, True, True, False]
    anyio.run(flow)

def test_receiver_redirect_and_unknown_slug():
    import anyio
    receiver = create_receiver_app()
    async def flow():
        ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r")
        await ac.post("/api/config", json={"slug": "hop", "secret": "s", "behavior": "redirect"})
        r = await _post(receiver, "hop", b"{}", "s", "dlv_r", int(time.time()))
        assert r.status_code == 302          # sender must treat 3xx as terminal; worker test asserts no follow
        assert (await _post(receiver, "nope", b"{}", "s", "dlv_x", int(time.time()))).status_code == 404
    anyio.run(flow)
```

- [ ] **Step 2: Run `uv run pytest tests/test_receiver.py -q`** — expected FAIL.

- [ ] **Step 3: Implement.** Verify order: slug configured → headers present/parseable → timestamp within ±300 → HMAC constant-time. On verified request: append log entry `{delivery_id, verified: True, duplicate, received_at, body: body.decode(errors="replace")}`; dedupe by delivery id (if already seen successfully → 200 `{"duplicate": true}` without behavior side effect); behavior: `success` → 200, `fail_once` → 500 first verified request per delivery id then 200, `always_fail` → 500 always, `slow` → `await anyio.sleep(config.slow_seconds)` (default 3) then 200, `slow_fail` → sleep then 500, `redirect` → 302 to `/webhooks/elsewhere`, `fail_count:<n>` → 500 while `failures[delivery_id] < n` then 200. Failures (bad signature/stale/unknown slug) return 401/404 with `{error}` and are logged with `verified: False`. Config/reset routes are admin (not `/webhooks/`). `GET /` renders a minimal HTML page (inline CSS) listing config form and log; payload text escaped via `html.escape`.

- [ ] **Step 4: Run the same tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add receiver tests/test_receiver.py
git commit -m "Add demo receiver with signature verification, dedupe, and behaviors"
```

### Task 7: Worker first rope — claim, sign, send, record success

**Files:**
- Create: `backend/app/worker.py`, `tests/test_worker_delivery.py`
- Modify: `backend/app/api.py` (lifespan starts worker when `settings.worker_enabled`), `tests/conftest.py`

**Interfaces:**
- Consumes: `store.claim_due_delivery`, `store.complete_attempt`, `signing.*`, `policy.validate_url`, `Settings`.
- Produces: `worker.DeliveryWorker(conn_factory: Callable[[], sqlite3.Connection], settings: Settings)` with `async def tick() -> int` and `async def run_forever() -> None`; `store.claim_due_delivery(conn, now, excluded_endpoint_ids: set[str]) -> ClaimedDelivery | None` (`ClaimedDelivery{id, endpoint_id, url, secret, event_payload, attempt_number}`); `store.complete_attempt(conn, delivery_id, outcome, http_status, response_excerpt, next_due_at, terminal_status) -> None` (`outcome: str`, `next_due_at: float | None`, `terminal_status: str | None`; increments `cycle_attempts`, inserts the attempt row with the next monotonic number, updates status/lease); `tests/conftest.py` gains `receiver` (uvicorn thread on a free port, exposing `configure(slug, secret, behavior, slow_seconds=None)`, `requests()`, `reset()`) and `make_env(receiver_behavior="success", **settings_overrides)` returning an `env` helper object with methods `create_endpoint(types, slug="crm")`, `submit_event(key, type, payload)`, `get_event(id)`, `get_delivery(id)`, `deliveries()`, `list_events()`, `receiver_requests()`, `receiver_request_count()`, `worker` (a started `DeliveryWorker`), and `client`.

- [ ] **Step 1: Write the failing test `tests/test_worker_delivery.py`** (uses the `receiver` fixture: uvicorn in a thread on a free port; registers a config via HTTP; overrides `BENJI_RECEIVER_ORIGIN` per-test)

```python
import asyncio

def test_acceptance_persists_then_worker_delivers_signed_request(make_env):
    env = make_env(receiver_behavior="success")          # fixture: temp db, Settings, client, receiver origin
    ep = env.create_endpoint(["reward_transaction_created"])
    body = env.submit_event("k1", "reward_transaction_created", {"amount": 7})
    detail = env.get_event(body["event_id"])
    assert detail["deliveries"][0]["status"] == "pending"      # persisted before any HTTP
    asyncio.run(env.worker.tick())
    got = env.receiver_requests()
    assert len(got) == 1 and got[0]["verified"] is True and got[0]["body"] == '{"amount":7}'
    d = env.get_delivery(detail["deliveries"][0]["id"])
    assert d["status"] == "succeeded" and d["attempts"][0]["outcome"] == "success"
    assert d["attempts"][0]["http_status"] == 200 and d["attempts"][0]["number"] == 1

def test_dispatch_revalidates_destination_policy(make_env):
    env = make_env(receiver_behavior="success")
    env.create_endpoint(["a"])
    env.submit_event("k1", "a", {})
    env.settings.receiver_origin = "http://127.0.0.1:9999"    # policy changed after registration
    asyncio.run(env.worker.tick())
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["status"] == "failed" and d["attempts"][0]["outcome"] == "policy_error"
    assert env.receiver_request_count() == 0                   # nothing was sent
```

- [ ] **Step 2: Run `uv run pytest tests/test_worker_delivery.py -q`** — expected FAIL.

- [ ] **Step 3: Implement `claim_due_delivery`**: one transaction; atomic `UPDATE deliveries SET status='in_progress', lease_expires_at=? ... WHERE id = (SELECT ... JOIN endpoints e ON e.id=endpoint_id AND e.enabled=1 WHERE status IN ('pending','retrying') AND due_at <= ? AND endpoint_id NOT IN (excluded) ORDER BY due_at LIMIT 1) RETURNING ...`; read endpoint secret/url and event payload; `attempt_number = COALESCE(MAX(number),0)+1`; if no row → `None`.

Implement `complete_attempt`: transaction; insert attempt `(delivery_id, number, started_at, finished_at, outcome, http_status, response_excerpt[:1024])`; `cycle_attempts += 1`; if `terminal_status` → set status, clear `due_at`/lease; elif `next_due_at` is not None → status `retrying`, set `due_at=next_due_at`, clear lease; else status stays/→ handled by caller (success sets terminal `succeeded`).

Implement `DeliveryWorker`:
`tick()` claims up to `max_concurrency` deliveries (never two for an endpoint in flight), spawns `_attempt` tasks under `asyncio.Semaphore(max_concurrency)` + `in_flight_endpoints: set[str]`, `await asyncio.gather(...)`, returns count. `_attempt`: first revalidate the destination with `policy.validate_url(delivery.url, settings.receiver_origin)`; on `PolicyError` record `outcome="policy_error"` terminal `failed` and send nothing. Otherwise build `body = payload.encode()`, `timestamp = int(time.time())`, headers per FR-07; `httpx.AsyncClient(timeout=settings.request_timeout, follow_redirects=False)`; classify: 2xx → `complete_attempt(outcome="success", http_status, excerpt, terminal_status="succeeded")`; 408/429/5xx → outcome `retryable_http`; other status → `http_error` terminal `failed`; `httpx.TimeoutException` → `timeout`; other `httpx.HTTPError` → `transport_error`; excerpt = first 1024 bytes of response text decoded with `errors="replace"`. For retryable outcomes: if `attempt_number < 3` → `next_due_at = now + settings.retry_delays[attempt_number - 1]`; else terminal `failed`. Outcome classification and delay selection live in `worker.classify_response(status) -> str` and `worker.retry_delay(settings, attempt_number) -> float` for unit-level exactness. `run_forever` loops `tick()` then sleeps `tick_interval` (or 0 when work was claimed), until cancelled; lifespan creates the worker with `connect(settings.db_path)` per tick and cancels it on shutdown.

- [ ] **Step 4: Run the test** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/worker.py backend/app/api.py tests/test_worker_delivery.py
git commit -m "Add delivery worker first rope with signed success path"
```

### Task 8: Retry classification, backoff, exhaustion

**Files:**
- Modify: `backend/app/worker.py`, `tests/conftest.py`
- Create: `tests/test_worker_retry.py`

**Interfaces:**
- Consumes: Task 7 worker + complete_attempt.
- Produces: exact behavior of `classify_response(status: int) -> str` (`success` 2xx, `retryable_http` 408/429/5xx, `http_error` otherwise) and `retry_delay(settings, attempt_number) -> float` (`settings.retry_delays[attempt_number - 1]`).

- [ ] **Step 1: Write the failing tests**

```python
def test_classification_and_schedule_are_exact():
    from app.worker import classify_response, retry_delay
    from app.config import Settings
    assert classify_response(200) == "success" and classify_response(204) == "success"
    assert classify_response(408) == "retryable_http" and classify_response(429) == "retryable_http"
    assert classify_response(500) == "retryable_http" and classify_response(503) == "retryable_http"
    assert classify_response(400) == "http_error" and classify_response(404) == "http_error"
    assert classify_response(302) == "http_error"
    s = Settings()
    assert retry_delay(s, 1) == 2.0 and retry_delay(s, 2) == 4.0

def test_fail_once_then_success_appends_attempt(make_env):
    env = make_env(receiver_behavior="fail_once", retry_delays="0.05,0.1")
    d = env.deliver_once()                                  # submits event + drives worker until terminal
    assert d["status"] == "succeeded" and [a["number"] for a in d["attempts"]] == [1, 2]
    assert d["attempts"][0]["http_status"] == 500 and d["attempts"][1]["http_status"] == 200
    assert env.receiver_requests()[-1]["delivery_id"] == d["id"]   # stable delivery id across attempts

def test_exhaustion_terminates_failed_after_three_attempts(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = env.deliver_once()
    assert d["status"] == "failed" and [a["number"] for a in d["attempts"]] == [1, 2, 3]
    assert all(a["outcome"] == "retryable_http" for a in d["attempts"])

def test_terminal_3xx_is_not_followed_and_does_not_retry(make_env):
    env = make_env(receiver_behavior="redirect", retry_delays="0.05,0.1")
    d = env.deliver_once()
    assert d["status"] == "failed" and len(d["attempts"]) == 1
    assert d["attempts"][0]["outcome"] == "http_error" and d["attempts"][0]["http_status"] == 302
    assert len(env.receiver_requests()) == 1                # no follow-up request to the redirect target

def test_timeout_is_classified_and_retried(make_env):
    env = make_env(receiver_behavior="slow", slow_seconds=1.0, request_timeout="0.2", retry_delays="0.05,0.1")
    d = env.deliver_once()
    assert len(d["attempts"]) == 3 and d["attempts"][0]["outcome"] == "timeout" and d["status"] == "failed"
```

- [ ] **Step 2: Run `uv run pytest tests/test_worker_retry.py -q`** — expected FAIL for the retry/backoff cases (Task 7 only succeeds on 2xx).

- [ ] **Step 3: Implement** the retry branches in `_attempt` exactly as specified in Task 7's implementation notes (classification, `retry_delay`, terminal vs retryable), and add to `tests/conftest.py` the helpers `deliver_once(delivery_id=None)` (loop `worker.tick()` with short `time.sleep` calls until the target delivery is `succeeded`/`failed`, then return its delivery detail through the API) and `drain_worker()` (tick until no delivery is `pending`/`retrying`).

- [ ] **Step 4: Run the tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/worker.py tests/test_worker_retry.py tests/conftest.py
git commit -m "Add retry classification, exponential backoff, and exhaustion"
```

### Task 9: Crash recovery, leases, and concurrency guards

**Files:**
- Modify: `backend/app/worker.py`, `backend/app/store.py`
- Create: `tests/test_worker_recovery.py`

**Interfaces:**
- Produces: `store.sweep_expired_leases(conn, now) -> int`; worker startup calls the sweep and the tick loop respects excluded in-flight endpoints; claim sets `lease_expires_at = now + settings.claim_lease_seconds`. `tests/conftest.py` env gains `conn()` (fresh connected+schema connection), `claim_due_delivery()` (one store claim, returns the delivery id or None), `sweep_leases()`, `disable_endpoint()` / `enable_endpoint()` via the API, and `worker` exposes `async def recover() -> int`.

- [ ] **Step 1: Write the failing tests**

```python
import asyncio, time

def test_expired_lease_marks_interrupted_and_retries_with_budget(make_env):
    env = make_env(receiver_behavior="success", claim_lease_seconds="0.05")
    env.create_endpoint(["a"]); env.submit_event("k", "a", {})
    assert env.claim_due_delivery() is not None           # claim happens, no HTTP is sent
    time.sleep(0.06)
    assert env.sweep_leases() == 1
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["attempts"][0]["outcome"] == "interrupted" and d["status"] == "retrying"
    d = env.deliver_once()
    assert d["status"] == "succeeded" and [a["number"] for a in d["attempts"]] == [1, 2]

def test_expired_lease_without_budget_fails_replayable(make_env):
    env = make_env(receiver_behavior="success", claim_lease_seconds="0.05")
    env.create_endpoint(["a"]); env.submit_event("k", "a", {})
    for _ in range(3):
        env.claim_due_delivery(); time.sleep(0.06); env.sweep_leases()
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["status"] == "failed" and [a["outcome"] for a in d["attempts"]] == ["interrupted"] * 3

def test_global_and_per_endpoint_concurrency_limits(make_env):
    env = make_env(receiver_behavior="slow", slow_seconds=0.3, request_timeout="5", max_concurrency="2")
    for slug in ("e1", "e2", "e3"):
        env.create_endpoint(["a"], slug=slug)
    env.submit_event("k", "a", {})
    assert asyncio.run(env.worker.tick()) == 2            # global limit: third delivery not claimed
    assert env.receiver_request_count() == 2
    assert {d["status"] for d in env.deliveries()} == {"succeeded", "succeeded", "pending"}

def test_one_in_flight_per_endpoint(make_env):
    env = make_env(receiver_behavior="slow", slow_seconds=0.3, request_timeout="5")
    env.create_endpoint(["a"]); env.submit_event("k1", "a", {}); env.submit_event("k2", "a", {})
    assert asyncio.run(env.worker.tick()) == 1            # same endpoint: second delivery waits
    env.drain_worker()
    assert all(d["status"] == "succeeded" for d in env.deliveries())

def test_disable_mid_flight_pauses_on_retryable_failure(make_env):     # Review Focus 5
    env = make_env(receiver_behavior="slow_fail", slow_seconds=0.3, request_timeout="5")
    env.create_endpoint(["a"]); env.submit_event("k", "a", {})
    async def flow():
        task = asyncio.create_task(env.worker.tick())
        await asyncio.sleep(0.1)                          # attempt is in flight
        env.disable_endpoint()
        await task
    asyncio.run(flow())
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["status"] == "paused" and d["attempts"][0]["outcome"] == "retryable_http"
    env.drain_worker()
    assert len(env.get_delivery(d["id"])["attempts"]) == 1   # never retried while paused
```

- [ ] **Step 2: Run `uv run pytest tests/test_worker_recovery.py -q`** — expected FAIL.

- [ ] **Step 3: Implement `sweep_expired_leases`:** in one transaction, select deliveries with `status='in_progress' AND lease_expires_at <= now`; for each: insert attempt row with outcome `interrupted`, `finished_at=now`, `cycle_attempts += 1`, `lease_expires_at=NULL`; if `cycle_attempts >= 3` → `failed`, else `retrying` with `due_at=now` (immediate). Return count. Worker `run_forever` calls it once at startup and exposes `async def recover() -> int` for tests. Also ensure `in_flight_endpoints` prevents same-endpoint claims within a tick and `_attempt` checks the endpoint's `enabled` flag after send (fetch it in the same transaction as the completion): if the endpoint is disabled and the outcome is retryable → status `paused`; terminal outcomes stand per FR-03.

- [ ] **Step 4: Run the tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/store.py backend/app/worker.py tests/test_worker_recovery.py
git commit -m "Add crash recovery, leases, and per-endpoint concurrency guards"
```

### Task 10: Replay API and paused-delivery gating

**Files:**
- Modify: `backend/app/store.py`, `backend/app/api.py`
- Create: `tests/test_replay.py`

**Interfaces:**
- Produces: `store.replay_delivery(conn, delivery_id, now) -> ReplayResult{ok: bool, reason: str | None}`; route `POST /api/deliveries/{id}/replay` → 202 `{delivery_id, status: "pending"}` or 409 `replay_unavailable`; conftest env gains `concurrent_replays(delivery_id, n)` (n parallel requests via threads, returns responses).

- [ ] **Step 1: Write the failing tests**

```python
def test_replay_only_failed_and_single_winner(make_env):     # Review Focus 5
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = env.deliver_once()
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    again = env.client.post(f"/api/deliveries/{d['id']}/replay")   # now pending: unavailable
    assert again.status_code == 409 and again.json()["code"] == "replay_unavailable"
    assert env.get_delivery(d["id"])["status"] == "pending"
    env.deliver_once()

def test_concurrent_replay_races_yield_one_cycle(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = env.deliver_once()
    results = env.concurrent_replays(d["id"], 5)
    assert sorted(r.status_code for r in results) == [202, 409, 409, 409, 409]

def test_replay_keeps_delivery_and_appends_attempts(make_env):
    env = make_env(receiver_behavior="fail_count:3", retry_delays="0.05,0.1")
    d = env.deliver_once()                                # 3 failures -> failed
    assert d["status"] == "failed" and len(d["attempts"]) == 3
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    d = env.deliver_once()
    assert d["status"] == "succeeded"
    assert [a["number"] for a in d["attempts"]] == [1, 2, 3, 4]
    assert env.receiver_requests()[-1]["delivery_id"] == d["id"]   # same delivery id at the receiver

def test_disabled_endpoint_blocks_replay_until_resumed(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = env.deliver_once(); env.disable_endpoint()
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 409
    env.enable_endpoint()
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    env.deliver_once()
```

- [ ] **Step 2: Run `uv run pytest tests/test_replay.py -q`** — expected FAIL.

- [ ] **Step 3: Implement.** `replay_delivery` in one transaction: delivery must exist, `status='failed'`, endpoint `enabled=1`; set `status='pending'`, `due_at=now`, `cycle_attempts=0`, `lease_expires_at=NULL`; return reason `not_failed` / `paused_endpoint` / `not_found` otherwise (409/404 mapping in the route; 404 for unknown id). Attempt numbering continues via Task 7's `COALESCE(MAX(number),0)+1`.

- [ ] **Step 4: Run the tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/store.py backend/app/api.py tests/test_replay.py
git commit -m "Add replay with same-delivery cycles and disabled-endpoint gating"
```

### Task 11: Overview endpoint

**Files:**
- Modify: `backend/app/store.py`, `backend/app/api.py`
- Create: `tests/test_overview.py`

**Interfaces:**
- Produces: `store.overview(conn) -> Overview{failed_count, retrying_count, earliest_due_at, latest_event}`; route `GET /api/overview`.

- [ ] **Step 1: Write the failing test**

```python
def test_overview_counts_and_latest(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    env.submit_event("k1", "a", {})
    env.submit_event("k2", "b", {})
    env.deliver_once()
    o = env.client.get("/api/overview").json()
    assert o["failed_count"] == 2 and o["retrying_count"] == 0
    assert o["latest_event"]["type"] == "b"
    env2 = make_env(receiver_behavior="success")
    env2.submit_event("k", "a", {})                        # pending, not retrying
    o2 = env2.client.get("/api/overview").json()
    assert o2["failed_count"] == 0 and o2["retrying_count"] == 0
```

- [ ] **Step 2: Run `uv run pytest tests/test_overview.py -q`** — expected FAIL.

- [ ] **Step 3: Implement.** `overview` executes four small queries (failed count, retrying count + `MIN(due_at)`, latest event by `created_at DESC`); `retrying_count` excludes `paused`; `earliest_due_at` null when none.

- [ ] **Step 4: Run the test** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/store.py backend/app/api.py tests/test_overview.py
git commit -m "Add overview signals endpoint"
```

### Task 12: Frontend endpoints panel

**Files:**
- Create: `frontend/src/state/endpoints.ts`, `frontend/src/components/EndpointsPanel.vue`, `frontend/tests/endpoints.test.ts`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `createDashboardApi`, `createEndpointsState(api)` surface from Shared Interfaces.
- Produces: `createEndpointsState`; `EndpointsPanel.vue` props `{api}`; DOM contracts: form with `aria-label="Endpoint name"`, `"Endpoint URL"`, `"Event types"`, `button[data-action="create-endpoint"]`, secret banner `[data-testid="secret-banner"]`, toggle buttons `[data-action="enable-endpoint"]` / `[data-action="disable-endpoint"]`.

- [ ] **Step 1: Write the failing test `frontend/tests/endpoints.test.ts`**

Test-file helpers (reused by later frontend tasks): `fakeApi(overrides)` returns `{ ...createDashboardApi(), ...overrides }` as the API type, and `endpointFixture` is a complete `Endpoint` object `{id:"ep_1", name:"CRM", url:"http://127.0.0.1:9000/webhooks/crm", event_types:["a"], enabled:true, created_at:"2026-09-27T12:00:00Z"}`.

```ts
it("shows the secret once and never after reload", async () => {
  const api = fakeApi({ createEndpoint: async () => ({
    endpoint: { id: "ep_1", name: "CRM", url: "http://127.0.0.1:9000/webhooks/crm",
                event_types: ["a"], enabled: false, created_at: "2026-09-27T12:00:00Z" },
    secret: "whsec_once" }) });
  const w = mount(EndpointsPanel, { props: { api } });
  await w.get('input[aria-label="Endpoint name"]').setValue("CRM");
  await w.get('input[aria-label="Endpoint URL"]').setValue("http://127.0.0.1:9000/webhooks/crm");
  await w.get('[aria-label="Event types"]').setValue("a");
  await w.get('button[data-action="create-endpoint"]').trigger("click");
  await flushPromises();
  expect(w.get('[data-testid="secret-banner"]').text()).toContain("whsec_once");
  await w.get('[data-action="dismiss-secret"]').trigger("click");
  await w.vm.$nextTick();
  expect(w.find('[data-testid="secret-banner"]').exists()).toBe(false);
  expect(w.text()).not.toContain("whsec_once");
});

it("disables the toggle while pending and surfaces errors inline", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const api = fakeApi({
    listEndpoints: async () => ({ items: [endpointFixture] }),
    setEndpointEnabled: async () => { await gate; throw new ApiError("validation_error", "Endpoint URL rejected.", 400); },
  });
  const w = mount(EndpointsPanel, { props: { api } });
  await flushPromises();
  const toggle = w.get('button[data-action="disable-endpoint"]');
  await toggle.trigger("click");
  expect((toggle.element as HTMLButtonElement).disabled).toBe(true);   // pending state
  release();
  await flushPromises();
  expect(w.text()).toContain("Endpoint URL rejected.");
});
```

- [ ] **Step 2: Run `cd frontend && npm test`** — expected FAIL.

- [ ] **Step 3: Implement** `createEndpointsState` (list, create, setEnabled, uniform polling surface) and the panel (create form with comma/enter-separated event types, secret banner with copy + dismiss, list rows with enabled badge and toggle, pending states disable buttons, inline `error` text, empty state "No endpoints yet — create one to start receiving events.").

- [ ] **Step 4: Run `npm test`** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state/endpoints.ts frontend/src/components/EndpointsPanel.vue frontend/tests/endpoints.test.ts frontend/src/App.vue
git commit -m "Add endpoints panel with one-time secret and enable/disable"
```

### Task 13: Frontend composer, events list, polling, staleness

**Files:**
- Create: `frontend/src/state/composer.ts`, `frontend/src/state/events.ts`, `frontend/src/state/overview.ts`, `frontend/src/components/EventComposer.vue`, `frontend/src/components/EventsList.vue`, `frontend/src/components/AppHeader.vue`, `frontend/tests/composer.test.ts`, `frontend/tests/polling.test.ts`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Produces: `createComposerState`, `createEventsState`, `createOverviewState`; `AppHeader.vue` props `{api}`; `EventsList.vue` props `{api, selectedEventId}` emits `select`; `EventComposer.vue` props `{api}`; DOM contracts: `select[aria-label="Event type"]` with the three Benji examples, `textarea[aria-label="Payload"]`, `button[data-action="submit-event"]`, responses `[data-testid="accepted"]`, `[data-testid="deduplicated"]`, `[data-testid="conflict"]`, `[data-testid="uncertain"]` with `button[data-action="check-resend"]` and `data-action="new-key"`, stale banner `[data-testid="stale-banner"]`.

- [ ] **Step 1: Write the failing tests**

Test-file helper (shared by composer and polling tests): `fakeApi(overrides)` as in Task 12; `submitValidEvent(w)` selects type `reward_transaction_created`, sets payload `{}`, and clicks `[data-action="submit-event"]`.

```ts
it("reports deduplicated resubmission with the original event id", async () => {
  const api = fakeApi({ submitEvent: async () => ({ event_id: "evt_orig", deduplicated: true }) });
  const w = mount(EventComposer, { props: { api } });
  await w.get('select[aria-label="Event type"]').setValue("reward_transaction_created");
  await w.get('button[data-action="submit-event"]').trigger("click");
  await flushPromises();
  expect(w.get('[data-testid="deduplicated"]').text()).toContain("evt_orig");
});

it("keeps the key and offers check-or-resend after a transport failure", async () => {
  let firstKey = "";
  const api = fakeApi({ submitEvent: async (input) => {
    firstKey = input.idempotency_key; throw new ApiError("transport_error", "network", null);
  } });
  const w = mount(EventComposer, { props: { api } });
  await submitValidEvent(w);
  expect(w.get('[data-testid="uncertain"]').exists()).toBe(true);
  await w.get('button[data-action="check-resend"]').trigger("click");
  await flushPromises();
  expect(api.submitEvent.mock.calls[1][0].idempotency_key).toBe(firstKey);
  await w.get('button[data-action="new-key"]').trigger("click");
  expect((w.get('input[data-testid="submission-key"]').element as HTMLInputElement).value).not.toBe(firstKey);
});

it("marks status stale on polling failure and recovers", async () => {
  vi.useFakeTimers();
  let failing = true;
  const api = fakeApi({
    getOverview: async () => (failing ? Promise.reject(new ApiError("transport_error", "down", null))
                                      : { failed_count: 0, retrying_count: 0, earliest_due_at: null, latest_event: null }),
    listEvents: async () => ({ items: [] }),
  });
  const overview = createOverviewState(api);
  overview.startPolling(2000);
  await vi.advanceTimersByTimeAsync(0);
  expect(overview.stale.value).toBe(true);
  failing = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(overview.stale.value).toBe(false);
  expect(overview.lastUpdatedAt.value).not.toBeNull();
  overview.stopPolling();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run `npm test`** — expected FAIL.

- [ ] **Step 3: Implement.** Composer generates `crypto.randomUUID()` keys; on `201` shows accepted with event id; on `200` dedup notice; `409` conflict inline; transport/5xx → uncertain panel retaining the key; explicit new key. Events list renders status count chips and emits selection. `createEventsState`/`createOverviewState` poll with `setInterval(intervalMs)`, skip when `document.hidden`, set `stale=true` + `lastUpdatedAt` on failure and clear on success; `stopPolling` on unmount. Header renders `Needs attention` and `Retrying` counts plus earliest due and the stale banner. The three Benji example types with one-line descriptions; custom type allowed.

- [ ] **Step 4: Run `npm test`** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state frontend/src/components/EventComposer.vue frontend/src/components/EventsList.vue frontend/src/components/AppHeader.vue frontend/tests/composer.test.ts frontend/tests/polling.test.ts frontend/src/App.vue
git commit -m "Add composer, events list, and live polling with stale state"
```

### Task 14: Frontend fan-out, delivery panel, replay

**Files:**
- Create: `frontend/src/state/delivery.ts`, `frontend/src/components/EventFlow.vue`, `frontend/src/components/DeliveryPanel.vue`, `frontend/tests/flow.test.ts`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Produces: `createDeliveryState(api)`; `EventFlow.vue` props `{api, eventId}` emits `select-delivery`; `DeliveryPanel.vue` props `{api, deliveryId}`; DOM contracts: `[data-testid="branch"]` with `data-status`, `[data-testid="no-receivers"]`, `[data-testid="attempt-row"]`, `button[data-action="replay"]`, `[data-testid="replay-unavailable"]`, payload `[data-testid="payload-json"]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("renders one branch per delivery with status text and icon", async () => {
  const api = fakeApi({ getEvent: async () => ({
    id: "evt_1", type: "reward_transaction_created", payload: { amount: 5 }, created_at: "2026-09-27T12:00:00Z",
    deliveries: [
      { id: "dlv_1", endpoint_id: "ep_1", endpoint_name: "Partner CRM", endpoint_url: "http://127.0.0.1:9000/webhooks/crm",
        status: "succeeded", due_at: null, attempts_count: 1 },
      { id: "dlv_2", endpoint_id: "ep_2", endpoint_name: "Rewards ledger", endpoint_url: "http://127.0.0.1:9000/webhooks/ledger",
        status: "retrying", due_at: "2026-09-27T12:00:04Z", attempts_count: 1 },
    ] }) });
  const w = mount(EventFlow, { props: { api, eventId: "evt_1" } });
  await flushPromises();
  const branches = w.findAll('[data-testid="branch"]');
  expect(branches).toHaveLength(2);
  expect(branches[0].attributes("data-status")).toBe("succeeded");
  expect(branches[0].text()).toContain("Partner CRM");
  expect(branches[1].attributes("data-status")).toBe("retrying");
  expect(branches[1].text()).toContain("Retrying");
  await branches[0].trigger("click");
  expect(w.emitted("select-delivery")?.[0]).toEqual(["dlv_1"]);
});

it("shows no-receivers explanation for an empty event", async () => {
  const api = fakeApi({ getEvent: async () => ({
    id: "evt_2", type: "campaign_updated", payload: {}, created_at: "2026-09-27T12:00:00Z", deliveries: [] }) });
  const w = mount(EventFlow, { props: { api, eventId: "evt_2" } });
  await flushPromises();
  expect(w.get('[data-testid="no-receivers"]').text()).toContain("No receivers matched");
});

it("offers replay only for failed deliveries and disables it while pending", async () => {
  const api = fakeApi({
    getDelivery: async () => ({ ...deliveryFixture, status: "failed" }),
    replayDelivery: async () => ({ delivery_id: "dlv_1", status: "pending" }),
  });
  const w = mount(DeliveryPanel, { props: { api, deliveryId: "dlv_1" } });
  await flushPromises();
  const btn = w.get('button[data-action="replay"]');
  await btn.trigger("click");
  expect((btn.element as HTMLButtonElement).disabled).toBe(true);   // pending state
  await flushPromises();
  expect(api.replayDelivery).toHaveBeenCalledWith("dlv_1");
});

it("labels timeout attempts outcome-unknown", async () => { ... attempts outcome "timeout" renders "outcome unknown at receiver" ... });
```

- [ ] **Step 2: Run `npm test`** — expected FAIL.

- [ ] **Step 3: Implement.** EventFlow fetches event detail, renders event card (type/id/age/counts) and branch list; branch opens `DeliveryPanel` (selected delivery id held by App). DeliveryPanel renders endpoint/URL, status, due time, attempt timeline (start/end/duration/outcome/http status/excerpt), payload as `<pre>` escaped text, replay gating (`failed` and endpoint enabled → enabled button; else explanatory text). Outfit with the palette and status classes from `style.css`.

- [ ] **Step 4: Run `npm test`** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state/delivery.ts frontend/src/components/EventFlow.vue frontend/src/components/DeliveryPanel.vue frontend/tests/flow.test.ts frontend/src/App.vue
git commit -m "Add event fan-out, delivery detail, and replay UI"
```

### Task 15: Golden-path test, README, deliverables, final evidence

**Files:**
- Create: `tests/test_golden_path.py`, `scripts/seed_demo.py`, `README.md`
- Modify: `docs/process/ai-usage.md`, `docs/process/worklog.md`, `docs/plan/implementation-plan.md` (append execution evidence section)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the golden-path integration test**

```python
def test_full_reviewer_journey(make_env):
    env = make_env(receiver_behavior="fail_once", retry_delays="0.05,0.1")
    ep = env.create_endpoint(["reward_transaction_created"])
    event = env.submit_event("journey-1", "reward_transaction_created", {"member": "m_1", "points": 10})
    d = env.deliver_once()
    assert d["status"] == "succeeded" and len(d["attempts"]) == 2
    assert env.receiver_requests()[0]["verified"] is True
    again = env.submit_event("journey-1", "reward_transaction_created", {"points": 10, "member": "m_1"})
    assert again["deduplicated"] is True and again["event_id"] == event["event_id"]
    assert env.receiver_request_count() == 2                     # no new HTTP for the deduplicated resend
    env.disable_endpoint(); env.submit_event("journey-2", "reward_transaction_created", {})
    assert env.list_events()[0]["deliveries"]["pending"] == 0   # disabled endpoint not routed to
    env.enable_endpoint()
```

- [ ] **Step 2: Run `uv run pytest -q`** — expected PASS (full backend suite).

- [ ] **Step 3: Run `cd frontend && npm test && npm run build`** — expected PASS.

- [ ] **Step 4: Write `README.md`:** overview; requirements (Python 3.12, uv, Node 22); setup (`uv sync --python 3.12 --group dev`, `cd frontend && npm ci`); three run commands (receiver :9000, API+worker :8000, dashboard :5173); the full walkthrough (create endpoints, configure receiver secrets, activate, submit events, watch retry, replay, inspect attempts, dedup demo); test commands; scope/safety (loopback-only, no login, receiver memory-only, production gaps); project records links.

- [ ] **Step 5: Write `scripts/seed_demo.py`:** idempotent demo seeding against a running API — creates CRM (two types) and ledger (one type) endpoints, prints the one-time secrets and receiver setup instructions, submits one shared event; document in README.

- [ ] **Step 6: Update process records:** `worklog.md` final focused-time total; `ai-usage.md` final tools summary and results; append to this plan an "Execution evidence" section: exact commands, results, candidate commit, and remaining cuts. Re-run the full backend and frontend suites once more on the final revision and record outputs.

- [ ] **Step 7: Commit**

```bash
git add README.md scripts tests docs
git commit -m "Add golden-path test, seed script, README, and final evidence"
```

---

## Execution Handoff

After Task 15: report the candidate revision, evidence, and limits to Dror; do not push. The GitHub submission is a separate step requiring his explicit approval (SUB-01).

## Tradeoffs, Cuts, and More-Time Design (assignment OUT-01 summary)

- **Key tradeoffs:** single process + SQLite rather than separate worker/broker (fastest honest local path; documented isolation limits); polling rather than SSE (sufficient at demo scale); immutable endpoint URL/subscriptions rather than versioning (simplicity; versioning documented as production evolution); deterministic 2s/4s backoff rather than jittered (reproducible demo).
- **Cuts:** auth/RBAC, rate limiting, endpoint editing, versioning/cutover, secret rotation, jitter, websockets, Playwright, load tests (full list and rationale in `docs/spec/design.md` section 12).
- **More-time design:** authenticated customer scope, public HTTPS destination policy with DNS/IP pinning, managed secrets with rotation, tuned jittered backoff, retention/redaction, broker-backed horizontal dispatch, measured capacity targets, and browser-automation coverage.

## Execution Evidence (2026-09-27, branch `lean-webhook-build`)

- **Candidate:** the post-review fix commit on `lean-webhook-build` (`git log -1`); all 15 tasks completed with per-task commits and ledger entries.
- **Independent review:** fresh-context review of `07719b0..bc44b1a` found 2 Critical, 4 Important, 9 Minor findings; all Critical/Important were fixed in one TDD pass (replay cycle budget, malformed-port 500s, NaN/deep-nesting acceptance, 400 error codes, disable/resume TOCTOU, missing fan-out polling). Minors were deferred and recorded in the ledger. No re-review was dispatched; each fix has a test that failed first.
- **Backend:** `uv run pytest -q` → **57 passed** on the final revision.
- **Frontend:** `cd frontend && npm test` → **16 passed** across 5 files; `npm run build` (vue-tsc + vite) → success.
- **Browser E2E (owner-requested addition after the review):** `python3 scripts/run_e2e.py` → **10 passed** (chromium, serial) covering REQ-001…REQ-009 through the real UI against all three services, including the retry, replay, deduplication, conflict, signature-rejection, escaped-payload, disable/no-match, and async-state paths. The Playwright cut in section 12 of the spec was lifted by Dror's explicit request; the spec and README were updated accordingly.
- **Dashboard redesign (owner-requested):** the journey renders on a read-only Vue Flow canvas (`@vue-flow/core` with background and controls) with the Benji-inspired visual language; the receiver page got a matching style pass. All suites and the build were rerun green after the change. The design spec's dashboard section records the flow canvas.
- **Demo simplification (owner-requested):** endpoints are created with a name and event types only — the receiver URL is generated server-side — and the receiver is configured by one-time secret plus behavior (no path slug anywhere). No-subscriber events get a pre-publish hint and a `no receivers` chip while still persisting.
- **Post-review UX iteration (owner-requested):** submission key rotates after acceptance unless manually edited; journey nodes carry attempt progress plus the last HTTP outcome with a structured `?` explanation; the delivery panel renders attempts as a timeline with durations and the next scheduled attempt; the receiver hint explains where the one-time secret appears. Final counts on this revision: **58 backend, 24 frontend, 10 E2E**, build green, verified from a fresh clone.
- **Boot smoke test:** the README's exact uvicorn commands run on spare ports; `GET /api/health` → `{"status":"ok"}` and the receiver page returns 200. The receiver command needs `PYTHONPATH=backend` so it verifies signatures with the sender's single signing implementation.
- **Remaining limits:** the E2E suite covers the browser journeys programmatically; a human visual review of the dashboard is still outstanding. Receiver state is in-memory; deferred minors stand; no push or submission.

## Playtest and Fix Pass (2026-09-28, branch `lean-webhook-build`)

- **Method:** the reviewer walkthrough was driven end-to-end through computer use against the three services on their documented ports with a fresh database (`data/playtest.sqlite3`), plus API and receiver probes for the boundary paths (tampered signature, stale timestamp, foreign host/port/path, secret projections). This pass also completes the human visual review of the dashboard and receiver left open on 2026-09-27.
- **Fixed, each with a test that failed first and one commit:**
  - *Recovery hole (AC-11):* `sweep_expired_leases` ran only at worker startup, so a restart inside the lease window stranded the delivery in `in_progress` forever (reproduced live: lease expired 95s+, zero attempts, invisible in the overview). `DeliveryWorker.tick()` now sweeps before claiming (`d11c0cd`); the new test never calls the sweep helper itself.
  - *Delivery panel mismatch:* switching events left the previous event's delivery rendered, including a Replay button. The panel now resets when the selection clears and re-reads the delivery before replaying (`dc3e41e`).
  - *Attempt wording:* journey nodes showed "attempt 6 of 3" after a replay. Event-detail summaries now carry `cycle_attempts` and progress is reported per cycle (`3a1c9d2`).
  - *Secret banner trap:* creating a second endpoint replaced the first endpoint's one-time secret, which can never be re-read. Unacknowledged secrets now stay listed until dismissed (`195250b`).
  - *Receiver refresh:* saving a secret required a manual reload; the page now refreshes its own list on success (`d075811`).
- **Live re-verification of the recovery fix:** the delivery stranded by the old build (`dlv_34241ef95495`) recovered on the next restart of the fixed build — attempt `#1 interrupted`, `#2 success (HTTP 200)`, `cycle_attempts: 2`.
- **Checks on the final code revision (`d075811`):** `uv run pytest -q` → **59 passed**; `cd frontend && npm test` → **28 passed** (5 files); `npm run build` → success; `python3 scripts/run_e2e.py` → **12 passed** (chromium, serial), including two new browser regressions (switching events clears the delivery panel; the receiver lists a saved secret without a manual reload).
- **Fresh-clone verification (2026-09-28, clone of `6a95cb8`):** a clean clone with no `.venv`, `node_modules`, `data/`, or `dist/` followed the README setup — `uv sync --python 3.12 --group dev` (5s), `npm ci` (8s), `npx playwright install chromium` — then reproduced every suite on that clone: **59 backend**, **28 frontend** (bundle hash identical to the working tree), **12 E2E**. The documented receiver and API commands (ports adjusted around the running demo, `BENJI_RECEIVER_ORIGIN` pointed at the spare receiver) served a real signed delivery — `verified: true`, delivered on attempt 1 — and created the default `data/benji.sqlite3` automatically in the pristine checkout.
- **Decision register (2026-09-28):** `docs/process/decisions-and-tradeoffs.md` consolidates the accepted and selected choices with rationale, alternatives, costs, and revisit triggers, including the four playtest-driven revisions.
- **Investigation entry points (2026-09-28, Dror-requested):** the dashboard selection is kept in the URL and a header **Find by ID** box resolves a pasted `evt_…`/`dlv_…` id (D-23). Checks on this revision: **59 backend**, **36 frontend**, **13 E2E** (new browser regression: a deep link and the ID lookup restore an investigation view), build green.
- **Investigation filters and attempt grouping (2026-09-28):** `GET /api/events` gained `status`, `type`, `endpoint_id`, `offset`, and a `total` count; the header signals and list facets drive it, and the delivery panel groups attempts per retry cycle with a live in-flight row fed by `claim_started_at` (D-13/D-19). Checks: **61 backend**, **42 frontend**, **14 E2E**.
- **Event-type registry and payload schemas (2026-09-28, Dror-requested):** one pydantic model per registered event type, opt-in per submission via `enforce_schema`, a composer switch with an explanatory tooltip, and `GET /api/event-types` for discovery (D-24/D-25). Checks on this revision: **68 backend**, **47 frontend**, **15 E2E**, build green.
- **Investigation actions and delivery trend (2026-09-28, Dror-requested):** the delivery panel shows a one-line outcome headline, copies a Markdown incident report, and can disable/resume its endpoint, copy the delivery id, or open the receiver; the journey replays every failed branch (D-26/D-27). `GET /api/event-types/{type}/stats` adds bucketed performance history for one event type, rendered as chips plus an inline SVG chart. Checks on this revision: **72 backend**, **56 frontend**, **17 E2E**, build green.
- **Pause, freshness, and amendment (2026-09-28):** one shared gate stops every panel's polling when **Pause live updates** is on, **Refresh now** re-fetches all panels, and each card header shows "live · updated Xs ago" or "paused" (D-28). The approved FR-01/FR-09 amendment recording the payload-schema rejection path is applied to the design spec. Checks on this revision: **72 backend**, **60 frontend**, **18 E2E**, build green.
- **Live affordances and layout (2026-09-28):** a pulsing live dot (static when paused), a quiet freshness label derived from each panel's interval, simulated traffic from the composer (D-29), reorderable panels with a remembered layout and reset (D-30), a tighter attempt timeline, and the redundant "Latest" header pill removed. Checks on this revision: **72 backend**, **70 frontend**, **20 E2E**, build green.
- **Still open:** receiver configuration stays in-memory; a lease swept while its endpoint is disabled is recorded as `retrying` rather than `paused` until the next resume; deferred minors stand; no push or submission.

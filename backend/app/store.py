import json
import secrets
import sqlite3
import time
from dataclasses import dataclass, field

from . import event_schemas
from .db import transaction
from .models import (
    ApiError,
    MAX_JSON_DEPTH,
    MAX_NAME_LENGTH,
    MAX_PAYLOAD_BYTES,
    canonical_json,
    json_depth,
    validate_event_type,
    validate_idempotency_key,
)
from .policy import validate_url
from .signing import generate_secret

DELIVERY_STATUSES = (
    "pending",
    "in_progress",
    "retrying",
    "paused",
    "succeeded",
    "failed",
)


@dataclass
class EndpointRecord:
    id: str
    name: str
    url: str
    event_types: list[str]
    secret: str
    enabled: bool
    created_at: float


@dataclass
class EventSummary:
    id: str
    type: str
    created_at: float
    deliveries: dict[str, int] = field(default_factory=lambda: {s: 0 for s in DELIVERY_STATUSES})


@dataclass
class DeliverySummary:
    id: str
    endpoint_id: str
    endpoint_name: str
    endpoint_url: str
    status: str
    due_at: float | None
    attempts_count: int
    cycle_attempts: int
    last_outcome: str | None = None
    last_http_status: int | None = None


@dataclass
class EventDetail:
    id: str
    type: str
    payload: object
    created_at: float
    deliveries: list[DeliverySummary] = field(default_factory=list)


@dataclass
class Acceptance:
    status: str  # "created" | "deduplicated"
    event_id: str


@dataclass
class ClaimedDelivery:
    id: str
    endpoint_id: str
    url: str
    secret: str
    event_payload: str
    attempt_number: int
    cycle_attempts: int
    started_at: float


@dataclass
class AttemptRecord:
    id: int
    number: int
    started_at: float
    finished_at: float | None
    outcome: str | None
    http_status: int | None
    response_excerpt: str | None


@dataclass
class DeliveryDetail:
    id: str
    event_id: str
    event_type: str
    event_payload: object
    event_created_at: float
    endpoint_id: str
    endpoint_name: str
    endpoint_url: str
    endpoint_enabled: bool
    status: str
    due_at: float | None
    cycle_attempts: int
    claim_started_at: float | None
    attempts: list[AttemptRecord] = field(default_factory=list)


def _endpoint_from_row(row) -> EndpointRecord:
    return EndpointRecord(
        id=row["id"],
        name=row["name"],
        url=row["url"],
        event_types=json.loads(row["event_types"]),
        secret=row["secret"],
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
    )


def create_endpoint(
    conn, name: str, url: str, event_types: list[str], receiver_origin: str
) -> tuple[EndpointRecord, str]:
    normalized_name = (name or "").strip()
    if not normalized_name or len(normalized_name) > MAX_NAME_LENGTH:
        raise ApiError("validation_error", "Endpoint name must be 1-100 characters.")
    if not event_types:
        raise ApiError("validation_error", "At least one event type is required.")
    for event_type in event_types:
        validate_event_type(event_type)
    endpoint_id = f"ep_{secrets.token_hex(6)}"
    target_url = url or f"{receiver_origin}/webhooks/{endpoint_id}"
    slug = validate_url(target_url, receiver_origin)
    if not slug:
        raise ApiError("validation_error", "A webhook path is required.")
    secret = generate_secret()
    now = time.time()
    with transaction(conn):
        conn.execute(
            "INSERT INTO endpoints (id, name, url, event_types, secret, enabled, created_at)"
            " VALUES (?, ?, ?, ?, ?, 0, ?)",
            (endpoint_id, normalized_name, target_url, json.dumps(event_types), secret, now),
        )
    row = conn.execute("SELECT * FROM endpoints WHERE id = ?", (endpoint_id,)).fetchone()
    return _endpoint_from_row(row), secret


def list_endpoints(conn) -> list[EndpointRecord]:
    rows = conn.execute("SELECT * FROM endpoints ORDER BY created_at").fetchall()
    return [_endpoint_from_row(row) for row in rows]


def get_endpoint(conn, endpoint_id: str) -> EndpointRecord | None:
    row = conn.execute("SELECT * FROM endpoints WHERE id = ?", (endpoint_id,)).fetchone()
    return _endpoint_from_row(row) if row else None


def set_endpoint_enabled(conn, endpoint_id: str, enabled: bool) -> EndpointRecord | None:
    now = time.time()
    with transaction(conn):
        row = conn.execute("SELECT * FROM endpoints WHERE id = ?", (endpoint_id,)).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE endpoints SET enabled = ? WHERE id = ?", (1 if enabled else 0, endpoint_id)
        )
        if enabled:
            conn.execute(
                "UPDATE deliveries SET status = 'failed', due_at = NULL, updated_at = ?"
                " WHERE endpoint_id = ? AND status = 'paused' AND cycle_attempts >= 3",
                (now, endpoint_id),
            )
            conn.execute(
                "UPDATE deliveries SET status = 'pending', updated_at = ?"
                " WHERE endpoint_id = ? AND status = 'paused' AND due_at <= ?",
                (now, endpoint_id, now),
            )
            conn.execute(
                "UPDATE deliveries SET status = 'retrying', updated_at = ?"
                " WHERE endpoint_id = ? AND status = 'paused' AND due_at > ?",
                (now, endpoint_id, now),
            )
        else:
            conn.execute(
                "UPDATE deliveries SET status = 'paused', updated_at = ?"
                " WHERE endpoint_id = ? AND status IN ('pending', 'retrying')",
                (now, endpoint_id),
            )
    return get_endpoint(conn, endpoint_id)


EVENT_STATUS_FILTERS = frozenset(
    {"pending", "in_progress", "retrying", "paused", "succeeded", "failed"}
)
NO_RECEIVERS_FILTER = "no_receivers"


@dataclass
class EventPage:
    items: list[EventSummary]
    total: int


def _event_filter(event_type, endpoint_id, status) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    if event_type is not None:
        clauses.append("e.type = ?")
        params.append(event_type)
    if endpoint_id is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = e.id AND d.endpoint_id = ?)"
        )
        params.append(endpoint_id)
    if status == NO_RECEIVERS_FILTER:
        clauses.append("NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = e.id)")
    elif status is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = e.id AND d.status = ?)"
        )
        params.append(status)
    return (" WHERE " + " AND ".join(clauses) if clauses else "", params)


def list_events(
    conn,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    event_type: str | None = None,
    endpoint_id: str | None = None,
) -> EventPage:
    where, params = _event_filter(event_type, endpoint_id, status)
    total = conn.execute(f"SELECT COUNT(*) AS n FROM events e{where}", params).fetchone()["n"]
    rows = conn.execute(
        f"SELECT e.id, e.type, e.created_at FROM events e{where}"
        " ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    summaries: list[EventSummary] = []
    for row in rows:
        summary = EventSummary(id=row["id"], type=row["type"], created_at=row["created_at"])
        counts = conn.execute(
            "SELECT status, COUNT(*) AS n FROM deliveries WHERE event_id = ? GROUP BY status",
            (row["id"],),
        ).fetchall()
        for count_row in counts:
            if count_row["status"] in summary.deliveries:
                summary.deliveries[count_row["status"]] = count_row["n"]
        summaries.append(summary)
    return EventPage(items=summaries, total=total)


def accept_event(
    conn,
    idempotency_key: str,
    event_type: str,
    payload: object,
    enforce_schema: bool = False,
) -> Acceptance:
    validate_idempotency_key(idempotency_key)
    validate_event_type(event_type)
    if not isinstance(payload, (dict, list)):
        raise ApiError("validation_error", "Payload must be a JSON object or array.")
    if json_depth(payload) > MAX_JSON_DEPTH:
        raise ApiError("validation_error", "Payload nesting is too deep.")
    try:
        canonical = canonical_json(payload)
    except ValueError as exc:
        raise ApiError(
            "validation_error", "Payload must not contain NaN or Infinity values."
        ) from exc
    if len(canonical.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ApiError("validation_error", "Payload exceeds the 32 KiB limit.")
    if enforce_schema:
        event_schemas.validate_payload(event_type, payload)
    now = time.time()
    with transaction(conn):
        existing = conn.execute(
            "SELECT id, type, payload FROM events WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if existing is not None:
            return _resolve_existing(existing, event_type, canonical)
        event_id = f"evt_{secrets.token_hex(6)}"
        try:
            conn.execute(
                "INSERT INTO events (id, idempotency_key, type, payload, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (event_id, idempotency_key, event_type, canonical, now),
            )
        except sqlite3.IntegrityError:
            existing = conn.execute(
                "SELECT id, type, payload FROM events WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            return _resolve_existing(existing, event_type, canonical)
        endpoints = conn.execute(
            "SELECT id, event_types FROM endpoints WHERE enabled = 1"
        ).fetchall()
        for endpoint in endpoints:
            if event_type in json.loads(endpoint["event_types"]):
                conn.execute(
                    "INSERT INTO deliveries (id, event_id, endpoint_id, status, due_at,"
                    " cycle_attempts, lease_expires_at, created_at, updated_at)"
                    " VALUES (?, ?, ?, 'pending', ?, 0, NULL, ?, ?)",
                    (f"dlv_{secrets.token_hex(6)}", event_id, endpoint["id"], now, now, now),
                )
    return Acceptance(status="created", event_id=event_id)


def _resolve_existing(existing, event_type: str, canonical: str) -> Acceptance:
    if existing["type"] == event_type and existing["payload"] == canonical:
        return Acceptance(status="deduplicated", event_id=existing["id"])
    raise ApiError(
        "idempotency_conflict",
        "This idempotency key was already used with different content.",
        409,
    )


def get_event(conn, event_id: str) -> EventDetail | None:
    row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if row is None:
        return None
    delivery_rows = conn.execute(
        "SELECT d.id, d.endpoint_id, d.status, d.due_at, d.cycle_attempts,"
        " e.name AS endpoint_name,"
        " e.url AS endpoint_url,"
        " (SELECT COUNT(*) FROM attempts a WHERE a.delivery_id = d.id) AS attempts_count,"
        " (SELECT a.outcome FROM attempts a WHERE a.delivery_id = d.id"
        "  ORDER BY a.number DESC LIMIT 1) AS last_outcome,"
        " (SELECT a.http_status FROM attempts a WHERE a.delivery_id = d.id"
        "  ORDER BY a.number DESC LIMIT 1) AS last_http_status"
        " FROM deliveries d JOIN endpoints e ON e.id = d.endpoint_id"
        " WHERE d.event_id = ? ORDER BY e.name",
        (event_id,),
    ).fetchall()
    return EventDetail(
        id=row["id"],
        type=row["type"],
        payload=json.loads(row["payload"]),
        created_at=row["created_at"],
        deliveries=[
            DeliverySummary(
                id=delivery["id"],
                endpoint_id=delivery["endpoint_id"],
                endpoint_name=delivery["endpoint_name"],
                endpoint_url=delivery["endpoint_url"],
                status=delivery["status"],
                due_at=delivery["due_at"],
                attempts_count=delivery["attempts_count"],
                cycle_attempts=delivery["cycle_attempts"],
                last_outcome=delivery["last_outcome"],
                last_http_status=delivery["last_http_status"],
            )
            for delivery in delivery_rows
        ],
    )


def get_delivery(conn, delivery_id: str) -> DeliveryDetail | None:
    row = conn.execute(
        "SELECT d.*, ev.type AS event_type, ev.payload AS event_payload,"
        " ev.created_at AS event_created_at, e.name AS endpoint_name, e.url AS endpoint_url,"
        " e.enabled AS endpoint_enabled"
        " FROM deliveries d JOIN events ev ON ev.id = d.event_id"
        " JOIN endpoints e ON e.id = d.endpoint_id WHERE d.id = ?",
        (delivery_id,),
    ).fetchone()
    if row is None:
        return None
    attempt_rows = conn.execute(
        "SELECT * FROM attempts WHERE delivery_id = ? ORDER BY number", (delivery_id,)
    ).fetchall()
    return DeliveryDetail(
        id=row["id"],
        event_id=row["event_id"],
        event_type=row["event_type"],
        event_payload=json.loads(row["event_payload"]),
        event_created_at=row["event_created_at"],
        endpoint_id=row["endpoint_id"],
        endpoint_name=row["endpoint_name"],
        endpoint_url=row["endpoint_url"],
        endpoint_enabled=bool(row["endpoint_enabled"]),
        status=row["status"],
        due_at=row["due_at"],
        cycle_attempts=row["cycle_attempts"],
        claim_started_at=row["claim_started_at"],
        attempts=[
            AttemptRecord(
                id=attempt["id"],
                number=attempt["number"],
                started_at=attempt["started_at"],
                finished_at=attempt["finished_at"],
                outcome=attempt["outcome"],
                http_status=attempt["http_status"],
                response_excerpt=attempt["response_excerpt"],
            )
            for attempt in attempt_rows
        ],
    )


@dataclass
class ReplayResult:
    ok: bool
    reason: str | None = None


@dataclass
class Overview:
    failed_count: int
    retrying_count: int
    earliest_due_at: float | None
    latest_event_id: str | None
    latest_event_type: str | None
    latest_event_created_at: float | None


def overview(conn) -> Overview:
    failed = conn.execute(
        "SELECT COUNT(*) AS n FROM deliveries WHERE status = 'failed'"
    ).fetchone()["n"]
    retrying = conn.execute(
        "SELECT COUNT(*) AS n, MIN(due_at) AS earliest FROM deliveries WHERE status = 'retrying'"
    ).fetchone()
    latest = conn.execute(
        "SELECT id, type, created_at FROM events ORDER BY created_at DESC, id DESC LIMIT 1"
    ).fetchone()
    return Overview(
        failed_count=failed,
        retrying_count=retrying["n"],
        earliest_due_at=retrying["earliest"],
        latest_event_id=latest["id"] if latest else None,
        latest_event_type=latest["type"] if latest else None,
        latest_event_created_at=latest["created_at"] if latest else None,
    )


def replay_delivery(conn, delivery_id: str, now: float) -> ReplayResult:
    with transaction(conn):
        row = conn.execute(
            "SELECT d.status, e.enabled FROM deliveries d"
            " JOIN endpoints e ON e.id = d.endpoint_id WHERE d.id = ?",
            (delivery_id,),
        ).fetchone()
        if row is None:
            return ReplayResult(ok=False, reason="not_found")
        if row["status"] != "failed":
            return ReplayResult(ok=False, reason="not_failed")
        if not row["enabled"]:
            return ReplayResult(ok=False, reason="paused_endpoint")
        conn.execute(
            "UPDATE deliveries SET status = 'pending', due_at = ?, cycle_attempts = 0,"
            " lease_expires_at = NULL, claim_started_at = NULL, updated_at = ? WHERE id = ?",
            (now, now, delivery_id),
        )
    return ReplayResult(ok=True)


def claim_due_delivery(
    conn, now: float, excluded_endpoint_ids: set[str], lease_seconds: float
) -> ClaimedDelivery | None:
    excluded = sorted(excluded_endpoint_ids)
    placeholders = ", ".join("?" for _ in excluded)
    condition = f" AND d.endpoint_id NOT IN ({placeholders})" if excluded else ""
    sql = (
        "SELECT d.id, d.endpoint_id, d.cycle_attempts, e.url, e.secret, ev.payload"
        " FROM deliveries d JOIN endpoints e ON e.id = d.endpoint_id"
        " JOIN events ev ON ev.id = d.event_id"
        " WHERE d.status IN ('pending', 'retrying') AND (d.due_at IS NULL OR d.due_at <= ?)"
        " AND e.enabled = 1" + condition +
        " ORDER BY d.due_at LIMIT 1"
    )
    with transaction(conn):
        row = conn.execute(sql, (now, *excluded)).fetchone()
        if row is None:
            return None
        next_number = conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM attempts WHERE delivery_id = ?",
            (row["id"],),
        ).fetchone()["n"]
        conn.execute(
            "UPDATE deliveries SET status = 'in_progress', lease_expires_at = ?,"
            " claim_started_at = ?, updated_at = ? WHERE id = ?",
            (now + lease_seconds, now, now, row["id"]),
        )
    return ClaimedDelivery(
        id=row["id"],
        endpoint_id=row["endpoint_id"],
        url=row["url"],
        secret=row["secret"],
        event_payload=row["payload"],
        attempt_number=next_number,
        cycle_attempts=row["cycle_attempts"],
        started_at=now,
    )


def complete_attempt(
    conn,
    delivery_id: str,
    started_at: float,
    outcome: str,
    http_status: int | None,
    response_excerpt: str | None,
    next_due_at: float | None,
    terminal_status: str | None,
    pause_if_disabled: bool = False,
) -> None:
    now = time.time()
    with transaction(conn):
        number = conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM attempts WHERE delivery_id = ?",
            (delivery_id,),
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO attempts (delivery_id, number, started_at, finished_at, outcome,"
            " http_status, response_excerpt) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                delivery_id,
                number,
                started_at,
                now,
                outcome,
                http_status,
                response_excerpt[:1024] if response_excerpt else None,
            ),
        )
        cycle = conn.execute(
            "SELECT cycle_attempts, due_at FROM deliveries WHERE id = ?", (delivery_id,)
        ).fetchone()
        should_pause = False
        if pause_if_disabled and terminal_status is None:
            endpoint_enabled = conn.execute(
                "SELECT e.enabled FROM endpoints e JOIN deliveries d ON d.endpoint_id = e.id"
                " WHERE d.id = ?",
                (delivery_id,),
            ).fetchone()["enabled"]
            should_pause = not endpoint_enabled
        if should_pause:
            status, due_at = "paused", cycle["due_at"]
        elif terminal_status is not None:
            status, due_at = terminal_status, None
        else:
            status, due_at = "retrying", next_due_at
        conn.execute(
            "UPDATE deliveries SET status = ?, due_at = ?, cycle_attempts = ?,"
            " lease_expires_at = NULL, claim_started_at = NULL, updated_at = ? WHERE id = ?",
            (status, due_at, cycle["cycle_attempts"] + 1, now, delivery_id),
        )


def sweep_expired_leases(conn, now: float, lease_seconds: float) -> int:
    with transaction(conn):
        rows = conn.execute(
            "SELECT id, cycle_attempts, claim_started_at FROM deliveries"
            " WHERE status = 'in_progress' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
            (now,),
        ).fetchall()
        for row in rows:
            number = conn.execute(
                "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM attempts WHERE delivery_id = ?",
                (row["id"],),
            ).fetchone()["n"]
            started_at = row["claim_started_at"] or (now - lease_seconds)
            conn.execute(
                "INSERT INTO attempts (delivery_id, number, started_at, finished_at, outcome)"
                " VALUES (?, ?, ?, ?, 'interrupted')",
                (row["id"], number, started_at, now),
            )
            cycle = row["cycle_attempts"] + 1
            if cycle >= 3:
                status, due_at = "failed", None
            else:
                status, due_at = "retrying", now
            conn.execute(
                "UPDATE deliveries SET status = ?, due_at = ?, cycle_attempts = ?,"
                " lease_expires_at = NULL, claim_started_at = NULL, updated_at = ? WHERE id = ?",
                (status, due_at, cycle, now, row["id"]),
            )
        return len(rows)

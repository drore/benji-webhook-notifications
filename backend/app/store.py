import json
import secrets
import sqlite3
import time
from dataclasses import dataclass, field

from .db import transaction
from .models import (
    ApiError,
    MAX_NAME_LENGTH,
    MAX_PAYLOAD_BYTES,
    canonical_json,
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
    slug = validate_url(url, receiver_origin)
    if not slug:
        raise ApiError("validation_error", "A webhook path slug is required.")
    endpoint_id = f"ep_{secrets.token_hex(6)}"
    secret = generate_secret()
    now = time.time()
    with transaction(conn):
        conn.execute(
            "INSERT INTO endpoints (id, name, url, event_types, secret, enabled, created_at)"
            " VALUES (?, ?, ?, ?, ?, 0, ?)",
            (endpoint_id, normalized_name, url, json.dumps(event_types), secret, now),
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


def list_events(conn, limit: int = 50) -> list[EventSummary]:
    rows = conn.execute(
        "SELECT id, type, created_at FROM events ORDER BY created_at DESC, id DESC LIMIT ?",
        (limit,),
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
    return summaries


def accept_event(conn, idempotency_key: str, event_type: str, payload: object) -> Acceptance:
    validate_idempotency_key(idempotency_key)
    validate_event_type(event_type)
    if not isinstance(payload, (dict, list)):
        raise ApiError("validation_error", "Payload must be a JSON object or array.")
    canonical = canonical_json(payload)
    if len(canonical.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ApiError("validation_error", "Payload exceeds the 32 KiB limit.")
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
        "SELECT d.id, d.endpoint_id, d.status, d.due_at, e.name AS endpoint_name,"
        " e.url AS endpoint_url,"
        " (SELECT COUNT(*) FROM attempts a WHERE a.delivery_id = d.id) AS attempts_count"
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
            )
            for delivery in delivery_rows
        ],
    )

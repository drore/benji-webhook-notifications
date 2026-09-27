import json
import secrets
import time
from dataclasses import dataclass, field

from .db import transaction
from .models import EndpointCreate, ApiError, MAX_NAME_LENGTH, validate_event_type
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

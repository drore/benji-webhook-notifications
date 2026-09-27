import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
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
"""


def connect(path: str | Path) -> sqlite3.Connection:
    resolved = Path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(resolved), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


@contextmanager
def transaction(conn: sqlite3.Connection):
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")

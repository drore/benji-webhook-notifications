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

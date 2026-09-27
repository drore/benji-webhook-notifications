import time

from app import store


def test_disabled_endpoint_pauses_on_retryable_completion_atomically(db_conn):
    ep, _ = store.create_endpoint(
        db_conn, "CRM", "http://127.0.0.1:9000/webhooks/crm", ["a"], "http://127.0.0.1:9000"
    )
    store.set_endpoint_enabled(db_conn, ep.id, True)
    now = time.time()
    db_conn.execute("INSERT INTO events VALUES ('evt_1','k1','a','{}',?)", (now,))
    db_conn.execute(
        "INSERT INTO deliveries (id, event_id, endpoint_id, status, due_at, cycle_attempts,"
        " lease_expires_at, created_at, updated_at)"
        " VALUES ('dlv_1','evt_1',?,'pending',?,0,NULL,?,?)",
        (ep.id, now, now, now),
    )
    claimed = store.claim_due_delivery(db_conn, now, set(), 10.0)
    assert claimed is not None
    store.set_endpoint_enabled(db_conn, ep.id, False)
    store.complete_attempt(
        db_conn,
        claimed.id,
        claimed.started_at,
        outcome="retryable_http",
        http_status=500,
        response_excerpt="boom",
        next_due_at=now + 2,
        terminal_status=None,
        pause_if_disabled=True,
    )
    row = db_conn.execute("SELECT status FROM deliveries WHERE id='dlv_1'").fetchone()
    assert row["status"] == "paused"


def test_disable_pauses_pending_and_retrying_and_resume_restores_due_times(db_conn):
    ep, _ = store.create_endpoint(
        db_conn, "CRM", "http://127.0.0.1:9000/webhooks/crm", ["a"], "http://127.0.0.1:9000"
    )
    store.set_endpoint_enabled(db_conn, ep.id, True)
    now = time.time()
    db_conn.execute("INSERT INTO events VALUES ('evt_1','k1','a','{}',?)", (now,))
    db_conn.execute(
        "INSERT INTO deliveries (id, event_id, endpoint_id, status, due_at, cycle_attempts,"
        " lease_expires_at, created_at, updated_at)"
        " VALUES ('dlv_1','evt_1',?,'pending',?,0,NULL,?,?)",
        (ep.id, now, now, now),
    )
    assert store.list_events(db_conn, 10)[0].deliveries["pending"] == 1
    store.set_endpoint_enabled(db_conn, ep.id, False)
    assert store.list_events(db_conn, 10)[0].deliveries["paused"] == 1
    store.set_endpoint_enabled(db_conn, ep.id, True)
    assert store.list_events(db_conn, 10)[0].deliveries["pending"] == 1

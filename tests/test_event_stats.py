import time


def test_stats_summarise_deliveries_attempts_and_success_rate(make_env):
    env = make_env(receiver_behavior="fail_count:1", retry_delays="0.05,0.1")
    env.create_endpoint(["trend_type"])
    env.submit_event("k1", "trend_type", {})
    env.deliver_once()

    stats = env.client.get("/api/event-types/trend_type/stats?hours=24&buckets=24").json()
    assert stats["type"] == "trend_type"
    assert stats["hours"] == 24 and len(stats["buckets"]) == 24
    assert stats["totals"]["events"] == 1
    assert stats["totals"]["deliveries"] == 1
    assert stats["totals"]["succeeded"] == 1
    assert stats["success_rate"] == 1.0
    assert stats["avg_attempts_per_delivery"] == 2.0
    assert stats["avg_attempt_ms"] is not None
    assert stats["buckets"][-1]["deliveries"] == 1


def test_stats_are_scoped_to_one_event_type_and_empty_windows_are_zeroed(make_env):
    env = make_env(receiver_behavior="success")
    env.create_endpoint(["trend_a"])
    env.submit_event("k1", "trend_a", {})
    env.deliver_once()

    other = env.client.get("/api/event-types/trend_b/stats?hours=6&buckets=6").json()
    assert other["totals"]["deliveries"] == 0
    assert other["totals"]["events"] == 0
    assert other["success_rate"] == 0
    assert other["avg_attempts_per_delivery"] is None
    assert len(other["buckets"]) == 6
    assert all(bucket["deliveries"] == 0 for bucket in other["buckets"])


def test_stats_reject_invalid_type_and_window_bounds(client):
    assert client.get("/api/event-types/bad type/stats").status_code == 400
    assert client.get("/api/event-types/ok/stats?hours=0").status_code == 400
    assert client.get("/api/event-types/ok/stats?hours=500").status_code == 400
    assert client.get("/api/event-types/ok/stats?buckets=0").status_code == 400
    assert client.get("/api/event-types/ok/stats?buckets=1000").status_code == 400


def test_stats_place_deliveries_in_the_right_time_buckets(db_conn):
    from app import store

    now = time.time()
    db_conn.execute(
        "INSERT INTO endpoints (id, name, url, event_types, secret, enabled, created_at)"
        " VALUES ('ep_stats', 'stats', 'http://127.0.0.1:9000/webhooks/ep_stats', '[\"trend\"]',"
        " 'whsec_x', 1, ?)",
        (now,),
    )
    for index, age_seconds in enumerate([90 * 60, 10 * 60]):
        event_id = f"evt_stats_{index}"
        db_conn.execute(
            "INSERT INTO events (id, idempotency_key, type, payload, created_at)"
            " VALUES (?, ?, 'trend', '{}', ?)",
            (event_id, f"key-{index}", now - age_seconds),
        )
        db_conn.execute(
            "INSERT INTO deliveries (id, event_id, endpoint_id, status, due_at, cycle_attempts,"
            " lease_expires_at, created_at, updated_at)"
            " VALUES (?, ?, 'ep_stats', 'succeeded', NULL, 1, NULL, ?, ?)",
            (f"dlv_stats_{index}", event_id, now - age_seconds, now - age_seconds),
        )

    stats = store.event_type_stats(db_conn, "trend", now, hours=6, buckets=6)
    assert [bucket["deliveries"] for bucket in stats["buckets"]] == [0, 0, 0, 0, 1, 1]
    assert stats["totals"]["deliveries"] == 2
    assert stats["totals"]["events"] == 2

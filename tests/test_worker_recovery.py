import asyncio
import time


def test_expired_lease_marks_interrupted_and_retries_with_budget(make_env):
    env = make_env(receiver_behavior="success", claim_lease_seconds="0.05")
    env.create_endpoint(["a"])
    env.submit_event("k", "a", {})
    assert env.claim_due_delivery() is not None
    time.sleep(0.06)
    assert env.sweep_leases() == 1
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["attempts"][0]["outcome"] == "interrupted" and d["status"] == "retrying"
    d = env.deliver_once()
    assert d["status"] == "succeeded" and [a["number"] for a in d["attempts"]] == [1, 2]


def test_expired_lease_without_budget_fails_replayable(make_env):
    env = make_env(receiver_behavior="success", claim_lease_seconds="0.05")
    env.create_endpoint(["a"])
    env.submit_event("k", "a", {})
    for _ in range(3):
        env.claim_due_delivery()
        time.sleep(0.06)
        env.sweep_leases()
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["status"] == "failed"
    assert [a["outcome"] for a in d["attempts"]] == ["interrupted"] * 3


def test_worker_tick_recovers_expired_lease_without_manual_sweep(make_env):
    """A restart inside the lease window must still recover the claim.

    The running worker loop has to sweep expired leases on its own; recovery that
    only happens at process start strands any claim whose lease expires later.
    """
    env = make_env(receiver_behavior="success", claim_lease_seconds="0.05")
    env.create_endpoint(["a"])
    env.submit_event("k", "a", {})
    assert env.claim_due_delivery() is not None  # claim held by the "crashed" process
    time.sleep(0.06)  # lease expires while that process is gone

    asyncio.run(env.worker.tick())  # no manual sweep_leases() call

    d = env.get_delivery(env.deliveries()[0]["id"])
    assert [a["outcome"] for a in d["attempts"]] == ["interrupted", "success"]
    assert d["status"] == "succeeded"
    assert d["attempts"][1]["number"] == 2


def test_global_and_per_endpoint_concurrency_limits(make_env):
    env = make_env(
        receiver_behavior="slow", slow_seconds=0.3, request_timeout="5", max_concurrency="2"
    )
    for slug in ("e1", "e2", "e3"):
        env.create_endpoint(["a"], slug=slug)
    env.submit_event("k", "a", {})
    assert asyncio.run(env.worker.tick()) == 2
    assert env.receiver_request_count() == 2
    assert {d["status"] for d in env.deliveries()} == {"succeeded", "succeeded", "pending"}


def test_one_in_flight_per_endpoint(make_env):
    env = make_env(receiver_behavior="slow", slow_seconds=0.3, request_timeout="5")
    env.create_endpoint(["a"])
    env.submit_event("k1", "a", {})
    env.submit_event("k2", "a", {})
    assert asyncio.run(env.worker.tick()) == 1
    env.drain_worker()
    assert all(d["status"] == "succeeded" for d in env.deliveries())


def test_disable_mid_flight_pauses_on_retryable_failure(make_env):
    env = make_env(receiver_behavior="slow_fail", slow_seconds=0.3, request_timeout="5")
    env.create_endpoint(["a"])
    env.submit_event("k", "a", {})

    async def flow():
        task = asyncio.create_task(env.worker.tick())
        await asyncio.sleep(0.1)
        env.disable_endpoint()
        await task

    asyncio.run(flow())
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["status"] == "paused" and d["attempts"][0]["outcome"] == "retryable_http"
    env.drain_worker()
    assert len(env.get_delivery(d["id"])["attempts"]) == 1


def test_resume_with_exhausted_budget_marks_failed(db_conn):
    from app import store

    ep, _ = store.create_endpoint(
        db_conn, "CRM", "http://127.0.0.1:9000/webhooks/crm", ["a"], "http://127.0.0.1:9000"
    )
    now = time.time()
    db_conn.execute("INSERT INTO events VALUES ('evt_1','k1','a','{}',?)", (now,))
    db_conn.execute(
        "INSERT INTO deliveries (id, event_id, endpoint_id, status, due_at, cycle_attempts,"
        " lease_expires_at, created_at, updated_at)"
        " VALUES ('dlv_1','evt_1',?,'paused',?,3,NULL,?,?)",
        (ep.id, now, now, now),
    )
    store.set_endpoint_enabled(db_conn, ep.id, True)
    row = db_conn.execute("SELECT status FROM deliveries WHERE id='dlv_1'").fetchone()
    assert row["status"] == "failed"

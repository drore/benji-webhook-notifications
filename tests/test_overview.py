def test_overview_counts_and_latest(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    env.create_endpoint(["a", "b"])
    env.submit_event("k1", "a", {})
    env.submit_event("k2", "b", {})
    env.deliver_once()
    o = env.client.get("/api/overview").json()
    assert o["failed_count"] == 2 and o["retrying_count"] == 0
    assert o["latest_event"]["type"] == "b"
    env2 = make_env(receiver_behavior="success")
    env2.create_endpoint(["a"])
    env2.submit_event("k", "a", {})
    o2 = env2.client.get("/api/overview").json()
    assert o2["failed_count"] == 0 and o2["retrying_count"] == 0
    assert o2["earliest_due_at"] is None

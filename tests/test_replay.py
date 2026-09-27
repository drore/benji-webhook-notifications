def _failed_delivery(env):
    env.create_endpoint(["a"])
    env.submit_event("k1", "a", {})
    return env.deliver_once()


def test_replay_only_failed_and_single_winner(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = _failed_delivery(env)
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    again = env.client.post(f"/api/deliveries/{d['id']}/replay")
    assert again.status_code == 409 and again.json()["code"] == "replay_unavailable"
    assert env.get_delivery(d["id"])["status"] == "pending"
    env.deliver_once()


def test_concurrent_replay_races_yield_one_cycle(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = _failed_delivery(env)
    results = env.concurrent_replays(d["id"], 5)
    assert sorted(r.status_code for r in results) == [202, 409, 409, 409, 409]


def test_replay_keeps_delivery_and_appends_attempts(make_env):
    env = make_env(receiver_behavior="fail_count:3", retry_delays="0.05,0.1")
    d = _failed_delivery(env)
    assert d["status"] == "failed" and len(d["attempts"]) == 3
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    d = env.deliver_once()
    assert d["status"] == "succeeded"
    assert [a["number"] for a in d["attempts"]] == [1, 2, 3, 4]
    assert env.receiver_requests()[-1]["delivery_id"] == d["id"]


def test_replay_cycle_retries_up_to_three_again(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = _failed_delivery(env)
    assert [a["number"] for a in d["attempts"]] == [1, 2, 3]
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    d = env.deliver_once()
    assert d["status"] == "failed"
    assert [a["number"] for a in d["attempts"]] == [1, 2, 3, 4, 5, 6]


def test_disabled_endpoint_blocks_replay_until_resumed(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = _failed_delivery(env)
    env.disable_endpoint()
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 409
    env.enable_endpoint()
    assert env.client.post(f"/api/deliveries/{d['id']}/replay").status_code == 202
    env.deliver_once()

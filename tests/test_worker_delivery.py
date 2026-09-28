import asyncio


def test_acceptance_persists_then_worker_delivers_signed_request(make_env):
    env = make_env(receiver_behavior="success")
    env.create_endpoint(["reward_transaction_created"])
    body = env.submit_event("k1", "reward_transaction_created", {"amount": 7})
    detail = env.get_event(body["event_id"])
    assert detail["deliveries"][0]["status"] == "pending"
    asyncio.run(env.worker.tick())
    got = env.receiver_requests()
    assert len(got) == 1 and got[0]["verified"] is True
    assert got[0]["body"] == '{"amount":7}'
    d = env.get_delivery(detail["deliveries"][0]["id"])
    assert d["status"] == "succeeded" and d["attempts"][0]["outcome"] == "success"
    assert d["attempts"][0]["http_status"] == 200 and d["attempts"][0]["number"] == 1


def test_dispatch_revalidates_destination_policy(make_env):
    env = make_env(receiver_behavior="success")
    env.create_endpoint(["a"])
    env.submit_event("k1", "a", {})
    env.settings.receiver_origin = "http://127.0.0.1:9999"
    asyncio.run(env.worker.tick())
    d = env.get_delivery(env.deliveries()[0]["id"])
    assert d["status"] == "failed" and d["attempts"][0]["outcome"] == "policy_error"
    assert env.receiver_request_count() == 0


def test_in_flight_delivery_exposes_its_claim_start_and_no_attempt_yet(make_env):
    """The dashboard can only show a running attempt if the API reports it."""
    env = make_env(receiver_behavior="slow", slow_seconds=0.4, request_timeout="5")
    env.create_endpoint(["a"])
    env.submit_event("k1", "a", {})

    async def flow():
        task = asyncio.create_task(env.worker.tick())
        await asyncio.sleep(0.1)
        detail = env.get_delivery(env.deliveries()[0]["id"])
        assert detail["status"] == "in_progress"
        assert detail["claim_started_at"] is not None
        assert detail["attempts"] == []
        await task

    asyncio.run(flow())
    done = env.get_delivery(env.deliveries()[0]["id"])
    assert done["status"] == "succeeded"

def test_full_reviewer_journey(make_env):
    env = make_env(receiver_behavior="fail_once", retry_delays="0.05,0.1")
    env.create_endpoint(["reward_transaction_created"])
    event = env.submit_event(
        "journey-1", "reward_transaction_created", {"member": "m_1", "points": 10}
    )
    d = env.deliver_once()
    assert d["status"] == "succeeded" and len(d["attempts"]) == 2
    assert env.receiver_requests()[0]["verified"] is True
    again = env.submit_event(
        "journey-1", "reward_transaction_created", {"points": 10, "member": "m_1"}
    )
    assert again["deduplicated"] is True and again["event_id"] == event["event_id"]
    assert env.receiver_request_count() == 2
    env.disable_endpoint()
    env.submit_event("journey-2", "reward_transaction_created", {})
    assert env.list_events()[0]["deliveries"]["pending"] == 0
    env.enable_endpoint()

def test_classification_and_schedule_are_exact():
    from app.config import Settings
    from app.worker import classify_response, retry_delay

    assert classify_response(200) == "success" and classify_response(204) == "success"
    assert classify_response(408) == "retryable_http" and classify_response(429) == "retryable_http"
    assert classify_response(500) == "retryable_http" and classify_response(503) == "retryable_http"
    assert classify_response(400) == "http_error" and classify_response(404) == "http_error"
    assert classify_response(302) == "http_error"
    s = Settings()
    assert retry_delay(s, 1) == 2.0 and retry_delay(s, 2) == 4.0


def _setup_and_deliver(env):
    env.create_endpoint(["a"])
    env.submit_event("k1", "a", {})
    return env.deliver_once()


def test_fail_once_then_success_appends_attempt(make_env):
    env = make_env(receiver_behavior="fail_once", retry_delays="0.05,0.1")
    d = _setup_and_deliver(env)
    assert d["status"] == "succeeded" and [a["number"] for a in d["attempts"]] == [1, 2]
    assert d["attempts"][0]["http_status"] == 500 and d["attempts"][1]["http_status"] == 200
    assert env.receiver_requests()[-1]["delivery_id"] == d["id"]
    summary = env.get_event(env.list_events()[0]["id"])["deliveries"][0]
    assert summary["last_outcome"] == "success" and summary["last_http_status"] == 200


def test_exhaustion_terminates_failed_after_three_attempts(make_env):
    env = make_env(receiver_behavior="always_fail", retry_delays="0.05,0.1")
    d = _setup_and_deliver(env)
    assert d["status"] == "failed" and [a["number"] for a in d["attempts"]] == [1, 2, 3]
    assert all(a["outcome"] == "retryable_http" for a in d["attempts"])
    summary = env.get_event(env.list_events()[0]["id"])["deliveries"][0]
    assert summary["last_outcome"] == "retryable_http" and summary["last_http_status"] == 500


def test_terminal_3xx_is_not_followed_and_does_not_retry(make_env):
    env = make_env(receiver_behavior="redirect", retry_delays="0.05,0.1")
    d = _setup_and_deliver(env)
    assert d["status"] == "failed" and len(d["attempts"]) == 1
    assert d["attempts"][0]["outcome"] == "http_error" and d["attempts"][0]["http_status"] == 302
    assert len(env.receiver_requests()) == 1


def test_timeout_is_classified_and_retried(make_env):
    env = make_env(
        receiver_behavior="slow",
        slow_seconds=1.0,
        request_timeout="0.2",
        retry_delays="0.05,0.1",
    )
    d = _setup_and_deliver(env)
    assert len(d["attempts"]) == 3
    assert d["attempts"][0]["outcome"] == "timeout" and d["status"] == "failed"

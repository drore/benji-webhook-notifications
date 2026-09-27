def test_fan_out_shared_single_and_none(client):
    for slug, types in [
        ("crm", ["reward_transaction_created", "member_account_linked"]),
        ("ledger", ["reward_transaction_created"]),
    ]:
        ep = client.post(
            "/api/endpoints",
            json={"name": slug, "url": f"http://127.0.0.1:9000/webhooks/{slug}", "event_types": types},
        ).json()["endpoint"]
        client.post(f"/api/endpoints/{ep['id']}/enable")
    shared = client.post(
        "/api/events",
        json={"idempotency_key": "k1", "type": "reward_transaction_created", "payload": {"amount": 5}},
    )
    assert shared.status_code == 201 and shared.json()["deduplicated"] is False
    detail = client.get(f"/api/events/{shared.json()['event_id']}").json()
    assert {d["endpoint_name"] for d in detail["deliveries"]} == {"crm", "ledger"}
    one = client.post(
        "/api/events", json={"idempotency_key": "k2", "type": "member_account_linked", "payload": {}}
    ).json()
    assert len(client.get(f"/api/events/{one['event_id']}").json()["deliveries"]) == 1
    none = client.post(
        "/api/events", json={"idempotency_key": "k3", "type": "campaign_updated", "payload": {}}
    ).json()
    assert client.get(f"/api/events/{none['event_id']}").json()["deliveries"] == []


def test_concurrent_same_key_creates_one_event_and_deliveries(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi.testclient import TestClient

    from app.api import create_app
    from app.config import Settings

    s = Settings(db_path=str(tmp_path / "c.sqlite3"), worker_enabled=False)
    with TestClient(create_app(s)) as client:
        ep = client.post(
            "/api/endpoints",
            json={"name": "crm", "url": "http://127.0.0.1:9000/webhooks/crm", "event_types": ["a"]},
        ).json()["endpoint"]
        client.post(f"/api/endpoints/{ep['id']}/enable")
        body = {"idempotency_key": "race", "type": "a", "payload": {"x": 1}}
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda _: client.post("/api/events", json=body), range(8)))
        assert sorted(r.status_code for r in responses) == [200] * 7 + [201]
        ids = {r.json()["event_id"] for r in responses}
        assert len(ids) == 1
        detail = client.get(f"/api/events/{ids.pop()}").json()
        assert len(detail["deliveries"]) == 1


def test_dedupe_conflict_and_key_order(client):
    first = client.post(
        "/api/events", json={"idempotency_key": "k", "type": "a", "payload": {"x": 1, "y": [2]}}
    )
    again = client.post(
        "/api/events", json={"idempotency_key": "k", "type": "a", "payload": {"y": [2], "x": 1}}
    )
    assert again.status_code == 200 and again.json()["event_id"] == first.json()["event_id"]
    assert again.json()["deduplicated"] is True
    conflict = client.post(
        "/api/events", json={"idempotency_key": "k", "type": "a", "payload": {"x": 2}}
    )
    assert conflict.status_code == 409 and conflict.json()["code"] == "idempotency_conflict"
    fresh = client.post(
        "/api/events", json={"idempotency_key": "k-new", "type": "a", "payload": {"x": 2}}
    )
    assert fresh.status_code == 201 and fresh.json()["event_id"] != first.json()["event_id"]


def test_intake_bounds_and_malformed(client):
    assert (
        client.post(
            "/api/events", content=b"{not json", headers={"content-type": "application/json"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/events", json={"idempotency_key": "k", "type": "a", "payload": "scalar"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/events", json={"idempotency_key": "x" * 129, "type": "a", "payload": {}}
        ).status_code
        == 400
    )
    at_limit = {"k": "a" * (32 * 1024 - 8)}  # canonical JSON is exactly 32768 bytes
    r = client.post("/api/events", json={"idempotency_key": "k-size", "type": "a", "payload": at_limit})
    assert r.status_code == 201
    over = {"k": "a" * (32 * 1024 - 7)}  # 32769 canonical bytes
    assert (
        client.post(
            "/api/events", json={"idempotency_key": "k-over", "type": "a", "payload": over}
        ).status_code
        == 400
    )


def test_disabled_endpoint_excluded_from_new_fan_out(client):
    client.post(
        "/api/endpoints",
        json={"name": "crm", "url": "http://127.0.0.1:9000/webhooks/crm", "event_types": ["a"]},
    )  # never enabled
    assert (
        client.post(
            "/api/events", json={"idempotency_key": "k", "type": "a", "payload": {}}
        ).status_code
        == 201
    )
    assert client.get("/api/events?limit=1").json()["items"][0]["deliveries"]["pending"] == 0

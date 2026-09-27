def test_create_returns_secret_once(client):
    r = client.post(
        "/api/endpoints",
        json={
            "name": "CRM",
            "url": "http://127.0.0.1:9000/webhooks/crm",
            "event_types": ["reward_transaction_created"],
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["secret"].startswith("whsec_") and body["endpoint"]["enabled"] is False
    listed = client.get("/api/endpoints").json()["items"]
    assert len(listed) == 1 and "secret" not in listed[0]


def test_create_generates_url_from_endpoint_id_when_omitted(client):
    response = client.post("/api/endpoints", json={"name": "CRM", "event_types": ["a"]})
    assert response.status_code == 201, response.text
    endpoint = response.json()["endpoint"]
    assert endpoint["url"] == f"http://127.0.0.1:9000/webhooks/{endpoint['id']}"


def test_create_validates_input(client):
    bad = client.post(
        "/api/endpoints",
        json={"name": "", "url": "http://example.com/webhooks/x", "event_types": []},
    )
    assert bad.status_code == 400 and bad.json()["code"] == "validation_error"
    for event_type in ["", "bad type", "x" * 65]:
        r = client.post(
            "/api/endpoints",
            json={
                "name": "n",
                "url": "http://127.0.0.1:9000/webhooks/x",
                "event_types": [event_type],
            },
        )
        assert r.status_code == 400


def test_enable_disable_roundtrip(client):
    ep = client.post(
        "/api/endpoints",
        json={
            "name": "CRM",
            "url": "http://127.0.0.1:9000/webhooks/crm",
            "event_types": ["a"],
        },
    ).json()["endpoint"]
    assert client.post(f"/api/endpoints/{ep['id']}/enable").json()["enabled"] is True
    assert client.post(f"/api/endpoints/{ep['id']}/disable").json()["enabled"] is False
    assert client.post("/api/endpoints/ep_missing/enable").status_code == 404

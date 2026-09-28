def _submit(client, key, payload, *, event_type="reward_transaction_created", enforce=None):
    body = {"idempotency_key": key, "type": event_type, "payload": payload}
    if enforce is not None:
        body["enforce_schema"] = enforce
    return client.post("/api/events", json=body)


def test_registry_holds_valid_type_names_with_property_schemas():
    from app.event_schemas import EVENT_PAYLOAD_MODELS, registered_types
    from app.models import TYPE_PATTERN

    assert EVENT_PAYLOAD_MODELS, "at least one event type is registered"
    for name, model in EVENT_PAYLOAD_MODELS.items():
        assert TYPE_PATTERN.match(name), name
        assert model.model_json_schema().get("properties"), name
    assert [item["name"] for item in registered_types()] == list(EVENT_PAYLOAD_MODELS)


def test_event_types_endpoint_describes_registered_types(client):
    response = client.get("/api/event-types")
    assert response.status_code == 200
    items = {item["name"]: item for item in response.json()["items"]}
    assert "reward_transaction_created" in items and "member_account_linked" in items
    schema = items["reward_transaction_created"]["schema"]
    assert set(schema["properties"]) == {"member", "points"}
    assert items["reward_transaction_created"]["description"]


def test_enforced_schema_accepts_a_conforming_payload(client):
    response = _submit(client, "k1", {"member": "m_1", "points": 10}, enforce=True)
    assert response.status_code == 201


def test_enforced_schema_rejects_bad_values_without_leaking_or_consuming(client):
    rejected = _submit(client, "k2", {"member": "m_1", "points": -1}, enforce=True)
    assert rejected.status_code == 400
    assert rejected.json()["code"] == "validation_error"
    assert "points" in rejected.json()["message"]
    assert "-1" not in rejected.json()["message"]  # describe the field, never echo the value
    assert client.get("/api/events").json()["total"] == 0

    corrected = _submit(client, "k2", {"member": "m_1", "points": 1}, enforce=True)
    assert corrected.status_code == 201


def test_enforced_schema_rejects_missing_wrong_and_extra_fields(client):
    missing = _submit(client, "k3", {"member": "m_1"}, enforce=True)
    assert missing.status_code == 400 and "points" in missing.json()["message"]

    wrong_type = _submit(client, "k4", {"member": "m_1", "points": "ten"}, enforce=True)
    assert wrong_type.status_code == 400 and "points" in wrong_type.json()["message"]

    extra = _submit(client, "k5", {"member": "m_1", "points": 1, "sneaky": True}, enforce=True)
    assert extra.status_code == 400 and "sneaky" in extra.json()["message"]

    assert client.get("/api/events").json()["total"] == 0


def test_schema_enforcement_is_opt_in_per_submission(client):
    response = _submit(client, "k6", {"member": "m_1", "points": -1})
    assert response.status_code == 201


def test_unregistered_types_keep_structural_validation_only(client):
    response = _submit(client, "k7", {"anything": 1}, event_type="custom.thing", enforce=True)
    assert response.status_code == 201

import time

import httpx

from receiver_app.app import create_receiver_app


async def _post(receiver, slug, body, secret, delivery_id, ts, *, sig=None):
    from app.signing import signature_header

    return await httpx.AsyncClient(
        transport=httpx.ASGITransport(app=receiver), base_url="http://r"
    ).post(
        f"/webhooks/{slug}",
        content=body,
        headers={
            "X-Webhook-Delivery-Id": delivery_id,
            "X-Webhook-Timestamp": str(ts),
            "X-Webhook-Signature": sig or signature_header(secret, delivery_id, ts, body),
        },
    )


def test_receiver_verifies_dedupes_and_behaves():
    import anyio

    receiver = create_receiver_app()

    async def flow():
        ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r")
        await ac.post(
            "/api/config", json={"secret": "whsec_test", "behavior": "fail_once"}
        )
        ts = int(time.time())
        body = b'{"a":1}'
        first = await _post(receiver, "crm", body, "whsec_test", "dlv_1", ts)
        assert first.status_code == 500
        second = await _post(receiver, "crm", body, "whsec_test", "dlv_1", ts)
        assert second.status_code == 200 and second.json()["duplicate"] is False
        again = await _post(receiver, "crm", body, "whsec_test", "dlv_1", ts)
        assert again.status_code == 200 and again.json()["duplicate"] is True
        from app.signing import signature_header

        bad = await _post(
            receiver,
            "crm",
            b'{"a":2}',
            "whsec_test",
            "dlv_1",
            ts,
            sig=signature_header("whsec_test", "dlv_1", ts, body),
        )
        assert bad.status_code == 401
        stale = await _post(receiver, "crm", body, "whsec_test", "dlv_2", ts - 301)
        assert stale.status_code == 401
        log = (await ac.get("/api/requests")).json()["items"]
        assert len(log) == 5
        assert [entry["verified"] for entry in log] == [True, True, True, False, False]

    anyio.run(flow)


def test_receiver_log_is_bounded(monkeypatch):
    import anyio

    import receiver_app.app as receiver_module

    monkeypatch.setattr(receiver_module, "MAX_LOGGED_REQUESTS", 3)
    receiver = receiver_module.create_receiver_app()

    async def flow():
        ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r")
        await ac.post("/api/config", json={"secret": "whsec_known", "behavior": "success"})
        ts = int(time.time())
        for number in range(4):
            response = await _post(
                receiver, "any", b"{}", "whsec_known", f"dlv_{number}", ts
            )
            assert response.status_code == 200
        log = (await ac.get("/api/requests")).json()["items"]
        assert [entry["delivery_id"] for entry in log] == ["dlv_1", "dlv_2", "dlv_3"]

    anyio.run(flow)


def test_receiver_accepts_any_path_but_requires_a_configured_secret():
    import anyio

    receiver = create_receiver_app()

    async def flow():
        ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r")
        await ac.post("/api/config", json={"secret": "whsec_known", "behavior": "redirect"})
        known = await _post(receiver, "any-path-ep_123", b"{}", "whsec_known", "dlv_r", int(time.time()))
        assert known.status_code == 302
        unknown = await _post(
            receiver, "any-path-ep_123", b"{}", "whsec_other", "dlv_x", int(time.time())
        )
        assert unknown.status_code == 401

    anyio.run(flow)

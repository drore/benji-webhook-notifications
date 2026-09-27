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
            "/api/config",
            json={"slug": "crm", "secret": "whsec_test", "behavior": "fail_once"},
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


def test_receiver_redirect_and_unknown_slug():
    import anyio

    receiver = create_receiver_app()

    async def flow():
        ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=receiver), base_url="http://r")
        await ac.post("/api/config", json={"slug": "hop", "secret": "s", "behavior": "redirect"})
        r = await _post(receiver, "hop", b"{}", "s", "dlv_r", int(time.time()))
        assert r.status_code == 302
        unknown = await _post(receiver, "nope", b"{}", "s", "dlv_x", int(time.time()))
        assert unknown.status_code == 404

    anyio.run(flow)

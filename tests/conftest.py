import socket
import threading
import time as time_module
from dataclasses import dataclass

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from app.db import connect, init_schema
from app.worker import DeliveryWorker


@pytest.fixture
def settings(tmp_path):
    return Settings(db_path=str(tmp_path / "test.sqlite3"), worker_enabled=False)


@pytest.fixture
def db_conn(settings):
    conn = connect(settings.db_path)
    init_schema(conn)
    yield conn
    conn.close()


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@dataclass
class ReceiverHandle:
    origin: str

    def configure(self, slug, secret, behavior="success", slow_seconds=None):
        payload = {"slug": slug, "secret": secret, "behavior": behavior}
        if slow_seconds is not None:
            payload["slow_seconds"] = slow_seconds
        response = httpx.post(f"{self.origin}/api/config", json=payload, timeout=5)
        response.raise_for_status()

    def requests(self):
        return httpx.get(f"{self.origin}/api/requests", timeout=5).json()["items"]

    def reset(self):
        httpx.post(f"{self.origin}/api/reset", timeout=5)


@pytest.fixture
def receiver():
    from receiver_app.app import create_receiver_app

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    config = uvicorn.Config(
        create_receiver_app(), host="127.0.0.1", port=port, log_level="warning"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{port}"
    deadline = time_module.time() + 10
    while time_module.time() < deadline:
        try:
            if httpx.get(f"{origin}/api/requests", timeout=0.5).status_code == 200:
                break
        except httpx.HTTPError:
            time_module.sleep(0.05)
    else:
        raise RuntimeError("receiver did not start")
    yield ReceiverHandle(origin)
    server.should_exit = True
    thread.join(timeout=5)


class Env:
    def __init__(self, settings, client, worker, receiver, behavior, slow_seconds):
        self.settings = settings
        self.client = client
        self.worker = worker
        self.receiver = receiver
        self._behavior = behavior
        self._slow_seconds = slow_seconds

    def create_endpoint(self, types, slug="crm", name=None):
        response = self.client.post(
            "/api/endpoints",
            json={
                "name": name or slug,
                "url": f"{self.receiver.origin}/webhooks/{slug}",
                "event_types": types,
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        self.receiver.configure(slug, body["secret"], self._behavior, self._slow_seconds)
        self.client.post(f"/api/endpoints/{body['endpoint']['id']}/enable")
        return body["endpoint"]

    def submit_event(self, key, event_type, payload):
        response = self.client.post(
            "/api/events",
            json={"idempotency_key": key, "type": event_type, "payload": payload},
        )
        assert response.status_code in (200, 201), response.text
        return response.json()

    def get_event(self, event_id):
        response = self.client.get(f"/api/events/{event_id}")
        assert response.status_code == 200, response.text
        return response.json()

    def get_delivery(self, delivery_id):
        response = self.client.get(f"/api/deliveries/{delivery_id}")
        assert response.status_code == 200, response.text
        return response.json()

    def list_events(self):
        return self.client.get("/api/events").json()["items"]

    def deliveries(self):
        conn = connect(self.settings.db_path)
        try:
            rows = conn.execute(
                "SELECT id, event_id, endpoint_id, status, due_at FROM deliveries"
                " ORDER BY created_at, id"
            ).fetchall()
        finally:
            conn.close()
        return [dict(row) for row in rows]

    def conn(self):
        return connect(self.settings.db_path)

    def claim_due_delivery(self):
        from app import store

        conn = self.conn()
        try:
            item = store.claim_due_delivery(
                conn, time_module.time(), set(), self.settings.claim_lease_seconds
            )
        finally:
            conn.close()
        return item.id if item else None

    def sweep_leases(self):
        from app import store

        conn = self.conn()
        try:
            return store.sweep_expired_leases(
                conn, time_module.time(), self.settings.claim_lease_seconds
            )
        finally:
            conn.close()

    def drain_worker(self, timeout=10):
        import asyncio

        deadline = time_module.time() + timeout
        while time_module.time() < deadline:
            asyncio.run(self.worker.tick())
            if not any(
                row["status"] in ("pending", "retrying", "in_progress")
                for row in self.deliveries()
            ):
                return
            time_module.sleep(0.02)
        raise AssertionError("worker did not drain")

    def receiver_requests(self):
        return self.receiver.requests()

    def receiver_request_count(self):
        return len(self.receiver.requests())

    def deliver_once(self, delivery_id=None, timeout=10):
        import asyncio

        deadline = time_module.time() + timeout
        while time_module.time() < deadline:
            asyncio.run(self.worker.tick())
            if delivery_id is not None:
                detail = self.get_delivery(delivery_id)
                if detail["status"] in ("succeeded", "failed", "paused"):
                    return detail
            else:
                details = [self.get_delivery(row["id"]) for row in self.deliveries()]
                if details and all(
                    detail["status"] in ("succeeded", "failed", "paused") for detail in details
                ):
                    return details[0]
            time_module.sleep(0.02)
        raise AssertionError("delivery did not reach a terminal state")

    def disable_endpoint(self, endpoint_id=None):
        endpoint = self._endpoint(endpoint_id)
        response = self.client.post(f"/api/endpoints/{endpoint}/disable")
        assert response.status_code == 200, response.text

    def enable_endpoint(self, endpoint_id=None):
        endpoint = self._endpoint(endpoint_id)
        response = self.client.post(f"/api/endpoints/{endpoint}/enable")
        assert response.status_code == 200, response.text

    def _endpoint(self, endpoint_id):
        if endpoint_id:
            return endpoint_id
        return self.deliveries()[0]["endpoint_id"]


@pytest.fixture
def make_env(tmp_path, receiver):
    entered_clients = []

    def _make(receiver_behavior="success", slow_seconds=None, **overrides):
        overrides.setdefault("worker_enabled", False)
        settings = Settings(
            db_path=str(tmp_path / f"env-{len(entered_clients)}.sqlite3"),
            receiver_origin=receiver.origin,
            **overrides,
        )
        app = create_app(settings)
        client = TestClient(app)
        client.__enter__()
        entered_clients.append(client)
        worker = DeliveryWorker(lambda: connect(settings.db_path), settings)
        return Env(settings, client, worker, receiver, receiver_behavior, slow_seconds)

    yield _make
    for client in entered_clients:
        client.__exit__(None, None, None)

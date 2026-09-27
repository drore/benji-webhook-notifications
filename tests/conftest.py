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

    def receiver_requests(self):
        return self.receiver.requests()

    def receiver_request_count(self):
        return len(self.receiver.requests())

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

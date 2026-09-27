import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from app.db import connect, init_schema


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

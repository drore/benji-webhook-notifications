from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import store
from .config import Settings, get_settings
from .db import connect, init_schema
from .models import ApiError, EndpointCreate
from .policy import PolicyError

_NOT_FOUND_CODE = "not_found"


def _error_response(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _endpoint_dto(record: store.EndpointRecord) -> dict:
    return {
        "id": record.id,
        "name": record.name,
        "url": record.url,
        "event_types": record.event_types,
        "enabled": record.enabled,
        "created_at": _iso(record.created_at),
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = resolved
        conn = connect(resolved.db_path)
        init_schema(conn)
        conn.close()
        app.state.conn_factory = lambda: connect(resolved.db_path)
        yield

    app = FastAPI(title="Benji webhook demo", lifespan=lifespan)

    def get_conn(request: Request):
        conn = request.app.state.conn_factory()
        try:
            yield conn
        finally:
            conn.close()

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError):
        return _error_response(exc.code, exc.message, exc.status_code)

    @app.exception_handler(PolicyError)
    async def policy_error_handler(_: Request, exc: PolicyError):
        return _error_response("validation_error", str(exc), 400)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError):
        return _error_response("validation_error", "Request validation failed", 400)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_: Request, exc: StarletteHTTPException):
        code = _NOT_FOUND_CODE if exc.status_code == 404 else "http_error"
        return _error_response(code, str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def internal_error_handler(_: Request, exc: Exception):
        return _error_response("internal_error", "Unexpected server error", 500)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/endpoints", status_code=201)
    def create_endpoint(payload: EndpointCreate, conn=Depends(get_conn)):
        record, secret = store.create_endpoint(
            conn, payload.name, payload.url, payload.event_types, resolved.receiver_origin
        )
        return {"endpoint": _endpoint_dto(record), "secret": secret}

    @app.get("/api/endpoints")
    def list_endpoints(conn=Depends(get_conn)):
        return {"items": [_endpoint_dto(record) for record in store.list_endpoints(conn)]}

    def _set_enabled(endpoint_id: str, enabled: bool, conn) -> dict:
        record = store.set_endpoint_enabled(conn, endpoint_id, enabled)
        if record is None:
            raise ApiError(_NOT_FOUND_CODE, "Endpoint not found.", 404)
        return _endpoint_dto(record)

    @app.post("/api/endpoints/{endpoint_id}/enable")
    def enable_endpoint(endpoint_id: str, conn=Depends(get_conn)):
        return _set_enabled(endpoint_id, True, conn)

    @app.post("/api/endpoints/{endpoint_id}/disable")
    def disable_endpoint(endpoint_id: str, conn=Depends(get_conn)):
        return _set_enabled(endpoint_id, False, conn)

    return app


app = create_app()

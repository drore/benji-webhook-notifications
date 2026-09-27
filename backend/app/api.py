from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone

import asyncio
import time

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import store
from .config import Settings, get_settings
from .db import connect, init_schema
from .models import ApiError, EndpointCreate, EventSubmit
from .policy import PolicyError
from .worker import DeliveryWorker

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


def _event_detail_dto(detail: store.EventDetail) -> dict:
    return {
        "id": detail.id,
        "type": detail.type,
        "payload": detail.payload,
        "created_at": _iso(detail.created_at),
        "deliveries": [
            {
                "id": item.id,
                "endpoint_id": item.endpoint_id,
                "endpoint_name": item.endpoint_name,
                "endpoint_url": item.endpoint_url,
                "status": item.status,
                "due_at": _iso(item.due_at) if item.due_at is not None else None,
                "attempts_count": item.attempts_count,
            }
            for item in detail.deliveries
        ],
    }


def _delivery_detail_dto(detail: store.DeliveryDetail) -> dict:
    return {
        "id": detail.id,
        "event_id": detail.event_id,
        "event": {
            "id": detail.event_id,
            "type": detail.event_type,
            "payload": detail.event_payload,
            "created_at": _iso(detail.event_created_at),
        },
        "endpoint": {
            "id": detail.endpoint_id,
            "name": detail.endpoint_name,
            "url": detail.endpoint_url,
            "enabled": detail.endpoint_enabled,
        },
        "status": detail.status,
        "due_at": _iso(detail.due_at) if detail.due_at is not None else None,
        "cycle_attempts": detail.cycle_attempts,
        "attempts": [
            {
                "id": attempt.id,
                "number": attempt.number,
                "started_at": _iso(attempt.started_at),
                "finished_at": _iso(attempt.finished_at) if attempt.finished_at else None,
                "outcome": attempt.outcome,
                "http_status": attempt.http_status,
                "response_excerpt": attempt.response_excerpt,
            }
            for attempt in detail.attempts
        ],
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
        worker_task: asyncio.Task | None = None
        if resolved.worker_enabled:
            worker = DeliveryWorker(app.state.conn_factory, resolved)
            worker_task = asyncio.create_task(worker.run_forever())
        try:
            yield
        finally:
            if worker_task is not None:
                worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await worker_task

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

    @app.post("/api/events")
    def submit_event(payload: EventSubmit, response: Response, conn=Depends(get_conn)):
        acceptance = store.accept_event(
            conn, payload.idempotency_key, payload.type, payload.payload
        )
        response.status_code = 201 if acceptance.status == "created" else 200
        return {
            "event_id": acceptance.event_id,
            "deduplicated": acceptance.status == "deduplicated",
        }

    @app.get("/api/events")
    def list_events(limit: int = 50, conn=Depends(get_conn)):
        bounded = max(1, min(limit, 200))
        return {
            "items": [
                {
                    "id": summary.id,
                    "type": summary.type,
                    "created_at": _iso(summary.created_at),
                    "deliveries": summary.deliveries,
                }
                for summary in store.list_events(conn, bounded)
            ]
        }

    @app.get("/api/events/{event_id}")
    def get_event(event_id: str, conn=Depends(get_conn)):
        detail = store.get_event(conn, event_id)
        if detail is None:
            raise ApiError(_NOT_FOUND_CODE, "Event not found.", 404)
        return _event_detail_dto(detail)

    @app.get("/api/deliveries/{delivery_id}")
    def get_delivery(delivery_id: str, conn=Depends(get_conn)):
        detail = store.get_delivery(conn, delivery_id)
        if detail is None:
            raise ApiError(_NOT_FOUND_CODE, "Delivery not found.", 404)
        return _delivery_detail_dto(detail)

    @app.post("/api/deliveries/{delivery_id}/replay", status_code=202)
    def replay_delivery(delivery_id: str, conn=Depends(get_conn)):
        result = store.replay_delivery(conn, delivery_id, time.time())
        if not result.ok:
            if result.reason == "not_found":
                raise ApiError(_NOT_FOUND_CODE, "Delivery not found.", 404)
            message = (
                "The endpoint is disabled; resume it before replaying."
                if result.reason == "paused_endpoint"
                else "Only failed deliveries can be replayed."
            )
            raise ApiError("replay_unavailable", message, 409)
        return {"delivery_id": delivery_id, "status": "pending"}

    @app.get("/api/overview")
    def get_overview(conn=Depends(get_conn)):
        summary = store.overview(conn)
        return {
            "failed_count": summary.failed_count,
            "retrying_count": summary.retrying_count,
            "earliest_due_at": _iso(summary.earliest_due_at)
            if summary.earliest_due_at is not None
            else None,
            "latest_event": {
                "id": summary.latest_event_id,
                "type": summary.latest_event_type,
                "created_at": _iso(summary.latest_event_created_at),
            }
            if summary.latest_event_id is not None
            else None,
        }

    return app


app = create_app()

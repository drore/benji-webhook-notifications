from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings, get_settings
from .db import connect, init_schema
from .models import ApiError

_NOT_FOUND_CODE = "not_found"


def _error_response(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


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

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError):
        return _error_response(exc.code, exc.message, exc.status_code)

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

    return app


app = create_app()

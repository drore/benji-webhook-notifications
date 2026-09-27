import os
from urllib.parse import urlsplit

from pydantic import BaseModel, field_validator

DEFAULT_DB_PATH = "data/benji.sqlite3"
DEFAULT_RECEIVER_ORIGIN = "http://127.0.0.1:9000"


class Settings(BaseModel):
    db_path: str = DEFAULT_DB_PATH
    receiver_origin: str = DEFAULT_RECEIVER_ORIGIN
    retry_delays: tuple[float, float] = (2.0, 4.0)
    request_timeout: float = 2.0
    claim_lease_seconds: float = 10.0
    tick_interval: float = 0.5
    max_concurrency: int = 4
    worker_enabled: bool = True

    @field_validator("retry_delays", mode="before")
    @classmethod
    def _parse_retry_delays(cls, value):
        if isinstance(value, str):
            parts = [float(part) for part in value.split(",") if part.strip()]
            if len(parts) != 2:
                raise ValueError("retry_delays needs exactly two comma-separated values")
            return tuple(parts)
        if isinstance(value, (list, tuple)) and len(value) == 2:
            return (float(value[0]), float(value[1]))
        raise ValueError("retry_delays must be a two-value tuple or 'a,b' string")

    @field_validator("receiver_origin")
    @classmethod
    def _validate_origin(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port:
            raise ValueError("receiver_origin must be http://127.0.0.1:<port>")
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("receiver_origin must contain only scheme, host, and port")
        return f"http://{parsed.hostname}:{parsed.port}"

    @field_validator("request_timeout", "claim_lease_seconds", "tick_interval", mode="before")
    @classmethod
    def _parse_positive_float(cls, value):
        number = float(value)
        if number <= 0:
            raise ValueError("value must be positive")
        return number

    @field_validator("max_concurrency", mode="before")
    @classmethod
    def _parse_positive_int(cls, value):
        number = int(value)
        if number <= 0:
            raise ValueError("max_concurrency must be positive")
        return number

    @field_validator("worker_enabled", mode="before")
    @classmethod
    def _parse_bool(cls, value):
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)


def _env(prefix: str, default: str) -> str:
    return os.environ.get(prefix, default)


def get_settings() -> Settings:
    return Settings(
        db_path=_env("BENJI_DB_PATH", DEFAULT_DB_PATH),
        receiver_origin=_env("BENJI_RECEIVER_ORIGIN", DEFAULT_RECEIVER_ORIGIN),
        retry_delays=_env("BENJI_RETRY_DELAYS", "2,4"),
        request_timeout=_env("BENJI_REQUEST_TIMEOUT", "2.0"),
        claim_lease_seconds=_env("BENJI_CLAIM_LEASE_SECONDS", "10.0"),
        tick_interval=_env("BENJI_TICK_INTERVAL", "0.5"),
        max_concurrency=_env("BENJI_MAX_CONCURRENCY", "4"),
        worker_enabled=_env("BENJI_WORKER_ENABLED", "true"),
    )

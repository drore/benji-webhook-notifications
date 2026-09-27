import json
import re

from pydantic import BaseModel

KEY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")
TYPE_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
MAX_PAYLOAD_BYTES = 32 * 1024
MAX_NAME_LENGTH = 100
MAX_JSON_DEPTH = 64


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class EndpointCreate(BaseModel):
    name: str
    url: str
    event_types: list[str]


class EventSubmit(BaseModel):
    idempotency_key: str
    type: str
    payload: object


def canonical_json(value: object) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def json_depth(value: object) -> int:
    depth = 0
    stack = [(value, 1)]
    while stack:
        current, level = stack.pop()
        depth = max(depth, level)
        if isinstance(current, list):
            stack.extend((item, level + 1) for item in current)
        elif isinstance(current, dict):
            stack.extend((item, level + 1) for item in current.values())
    return depth


def validate_event_type(event_type: str) -> None:
    if not TYPE_PATTERN.match(event_type or ""):
        raise ApiError(
            "validation_error",
            "Event types must be 1-64 characters from letters, digits, '_', '-', or '.'.",
        )


def validate_idempotency_key(key: str) -> None:
    if not KEY_PATTERN.match(key or ""):
        raise ApiError(
            "validation_error",
            "Idempotency keys must be 1-128 characters from letters, digits, '_', '-', or '.'.",
        )

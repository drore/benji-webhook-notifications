"""Registered payload contracts for event types.

Event types stay open: a publisher can send any valid type name. Registering a
type here adds a payload contract, and intake enforces it only when the caller
asks for it (`enforce_schema`), so unregistered types and existing API clients
keep their current behavior.
"""

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .models import TYPE_PATTERN, ApiError


class RewardTransactionCreated(BaseModel):
    """A reward transaction was recorded for a member."""

    model_config = ConfigDict(extra="forbid")

    member: str = Field(min_length=1, max_length=64)
    points: int = Field(ge=0)


class MemberAccountLinked(BaseModel):
    """A member linked an account."""

    model_config = ConfigDict(extra="forbid")

    member: str = Field(min_length=1, max_length=64)


EVENT_PAYLOAD_MODELS: dict[str, type[BaseModel]] = {
    "reward_transaction_created": RewardTransactionCreated,
    "member_account_linked": MemberAccountLinked,
}

for _name in EVENT_PAYLOAD_MODELS:
    if not TYPE_PATTERN.match(_name):
        raise ValueError(f"registered event type name is not valid: {_name}")


def registered_types() -> list[dict]:
    return [
        {
            "name": name,
            "description": (model.__doc__ or "").strip(),
            "schema": model.model_json_schema(),
        }
        for name, model in EVENT_PAYLOAD_MODELS.items()
    ]


def _describe(error: ValidationError) -> str:
    """Turn validation failures into field paths — never into payload values."""
    details = []
    for item in error.errors()[:5]:
        location = ".".join(str(part) for part in item["loc"]) or "payload"
        details.append(f"{location}: {item['msg']}")
    return "Payload does not match the registered schema — " + "; ".join(details)


def validate_payload(event_type: str, payload: object) -> None:
    model = EVENT_PAYLOAD_MODELS.get(event_type)
    if model is None:
        return
    try:
        model.model_validate(payload)
    except ValidationError as error:
        raise ApiError("validation_error", _describe(error), 400) from None

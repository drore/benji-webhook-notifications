import base64
import hashlib
import hmac
import secrets

SIGNATURE_VERSION = "v1"
SIGNATURE_WINDOW_SECONDS = 300
SECRET_PREFIX = "whsec_"


def generate_secret() -> str:
    raw = secrets.token_bytes(32)
    return SECRET_PREFIX + base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _signed_message(delivery_id: str, timestamp: int, body: bytes) -> bytes:
    return f"{timestamp}.{delivery_id}.".encode() + body


def sign(secret: str, delivery_id: str, timestamp: int, body: bytes) -> str:
    return hmac.new(
        secret.encode(), _signed_message(delivery_id, timestamp, body), hashlib.sha256
    ).hexdigest()


def signature_header(secret: str, delivery_id: str, timestamp: int, body: bytes) -> str:
    return f"{SIGNATURE_VERSION}={sign(secret, delivery_id, timestamp, body)}"


def verify(
    secret: str,
    delivery_id: str,
    timestamp_header: str,
    signature_header_value: str,
    body: bytes,
    now: int,
) -> bool:
    prefix = f"{SIGNATURE_VERSION}="
    if not signature_header_value.startswith(prefix):
        return False
    provided = signature_header_value[len(prefix) :]
    try:
        timestamp = int(timestamp_header)
    except (TypeError, ValueError):
        return False
    if abs(now - timestamp) > SIGNATURE_WINDOW_SECONDS:
        return False
    expected = sign(secret, delivery_id, timestamp, body)
    return hmac.compare_digest(expected, provided)

import re
from urllib.parse import urlsplit

PATH_SEGMENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
WEBHOOK_PATH_PREFIX = "/webhooks/"


class PolicyError(ValueError):
    code = "validation_error"


def validate_url(url: str, receiver_origin: str) -> str:
    """Validate an endpoint URL against the configured receiver origin.

    Returns the webhook path slug when valid, otherwise raises PolicyError.
    """
    try:
        origin = urlsplit(receiver_origin)
        parsed = urlsplit(url)
        parsed_port = parsed.port
        origin_port = origin.port
    except ValueError as exc:
        raise PolicyError("The URL is malformed.") from exc

    if parsed.scheme != origin.scheme:
        raise PolicyError("Only http URLs are allowed.")
    if parsed.hostname != origin.hostname or parsed_port != origin_port:
        raise PolicyError("Only the configured receiver host and port are allowed.")
    if parsed.username or parsed.password:
        raise PolicyError("Credentials are not allowed in endpoint URLs.")
    if parsed.query or parsed.fragment:
        raise PolicyError("Query strings and fragments are not allowed.")
    if not parsed.path.startswith(WEBHOOK_PATH_PREFIX):
        raise PolicyError("Only /webhooks/ receiver paths are allowed.")
    slug = parsed.path[len(WEBHOOK_PATH_PREFIX) :]
    if "/" in slug or not PATH_SEGMENT_PATTERN.match(slug):
        raise PolicyError("The webhook path must be a single URL-safe segment.")
    return slug

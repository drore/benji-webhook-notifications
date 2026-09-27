import pytest

from app.policy import PolicyError, validate_url

ORIGIN = "http://127.0.0.1:9000"


def test_accepts_only_exact_origin_webhook_paths():
    assert validate_url("http://127.0.0.1:9000/webhooks/crm", ORIGIN) == "crm"
    assert validate_url("http://127.0.0.1:9000/webhooks/ledger-2", ORIGIN) == "ledger-2"


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:9000/webhooks/crm",
        "http://localhost:9000/webhooks/crm",
        "http://127.0.0.1:9001/webhooks/crm",
        "http://127.0.0.1:9000/admin",
        "http://127.0.0.1:9000/Webhooks/crm",
        "http://127.0.0.1:9000/webhooks/UPPER",
        "http://127.0.0.1:9000/webhooks/crm?x=1",
        "http://127.0.0.1:9000/webhooks/crm#f",
        "http://user:pw@127.0.0.1:9000/webhooks/crm",
        "http://example.com/webhooks/crm",
        "ftp://127.0.0.1:9000/webhooks/crm",
        "http://127.0.0.1:9000/webhooks/",
        "http://127.0.0.1:9000/webhooks/a/b",
    ],
)
def test_rejects_everything_else(url):
    with pytest.raises(PolicyError):
        validate_url(url, ORIGIN)

from app import signing


def test_secret_shape_and_signature():
    secret = signing.generate_secret()
    assert secret.startswith("whsec_") and len(secret) == 6 + 43
    body = b'{"a":1}'
    header = signing.signature_header(secret, "dlv_abc", 1700000000, body)
    assert header.startswith("v1=") and len(header) == 3 + 64
    assert signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1700000000)


def test_verify_rejects_tampering_and_skew():
    secret = signing.generate_secret()
    body = b'{"a":1}'
    header = signing.signature_header(secret, "dlv_abc", 1700000000, body)
    assert not signing.verify(secret, "dlv_abc", "1700000000", header, b'{"a":2}', now=1700000000)
    assert not signing.verify(secret, "dlv_other", "1700000000", header, body, now=1700000000)
    assert not signing.verify(secret, "dlv_abc", "1700000000", "v1=00", body, now=1700000000)
    assert signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1700000300)
    assert not signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1700000301)
    assert signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1699999700)
    assert not signing.verify(secret, "dlv_abc", "1700000000", header, body, now=1699999699)
    assert not signing.verify(secret, "dlv_abc", "not-a-time", header, body, now=1700000000)

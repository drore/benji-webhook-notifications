"""Create the demo endpoints, enable them, and publish one shared event.

Usage: python3 scripts/seed_demo.py [--api http://127.0.0.1:8000] [--receiver http://127.0.0.1:9000]
Requires the sender API and dashboard processes to be running; it does not reset existing data.
"""

import argparse
import uuid

import httpx

DEMO_ENDPOINTS = [
    ("Partner CRM", "crm", ["reward_transaction_created", "member_account_linked"]),
    ("Rewards ledger", "ledger", ["reward_transaction_created"]),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--receiver", default="http://127.0.0.1:9000")
    args = parser.parse_args()
    client = httpx.Client(base_url=args.api, timeout=10)

    created = []
    for name, slug, event_types in DEMO_ENDPOINTS:
        response = client.post(
            "/api/endpoints",
            json={
                "name": name,
                "url": f"{args.receiver}/webhooks/{slug}",
                "event_types": event_types,
            },
        )
        response.raise_for_status()
        body = response.json()
        client.post(f"/api/endpoints/{body['endpoint']['id']}/enable").raise_for_status()
        created.append((name, slug, body["endpoint"]["id"], body["secret"]))

    print("Configure these in the receiver page (http://127.0.0.1:9000/):")
    for name, slug, endpoint_id, secret in created:
        print(f"  {name}: slug={slug} endpoint_id={endpoint_id} secret={secret}")
    print("Each receiver path needs behavior success, fail_once, or always_fail.")

    response = client.post(
        "/api/events",
        json={
            "idempotency_key": f"seed-{uuid.uuid4()}",
            "type": "reward_transaction_created",
            "payload": {"member": "m_demo", "points": 25},
        },
    )
    response.raise_for_status()
    body = response.json()
    print(f"Published event {body['event_id']} (deduplicated={body['deduplicated']}).")
    print("Open http://127.0.0.1:5173/ and select it in Recent events.")


if __name__ == "__main__":
    main()

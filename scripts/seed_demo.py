"""Create the demo endpoints, connect their secrets to the receiver, and publish one event.

Usage: python3 scripts/seed_demo.py [--api http://127.0.0.1:8000] [--receiver http://127.0.0.1:9000]
Requires the sender API and receiver to be running; it does not reset existing data.
"""

import argparse
import uuid

import httpx

DEMO_ENDPOINTS = [
    ("Partner CRM", ["reward_transaction_created", "member_account_linked"], "success"),
    ("Rewards ledger", ["reward_transaction_created"], "fail_once"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--receiver", default="http://127.0.0.1:9000")
    args = parser.parse_args()
    client = httpx.Client(base_url=args.api, timeout=10)

    print("Creating endpoints and connecting their one-time secrets to the receiver:")
    for name, event_types, behavior in DEMO_ENDPOINTS:
        response = client.post(
            "/api/endpoints", json={"name": name, "event_types": event_types}
        )
        response.raise_for_status()
        body = response.json()
        client.post(f"/api/endpoints/{body['endpoint']['id']}/enable").raise_for_status()
        httpx.post(
            f"{args.receiver}/api/config",
            json={"secret": body["secret"], "behavior": behavior},
        ).raise_for_status()
        print(f"  {name}: {body['endpoint']['url']} → receiver behavior '{behavior}'")

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

import asyncio
import time

import httpx

from . import signing, store
from .config import Settings
from .db import connect
from .policy import PolicyError, validate_url

RETRYABLE_STATUSES = {408, 429}


def classify_response(status: int) -> str:
    if 200 <= status < 300:
        return "success"
    if status in RETRYABLE_STATUSES or status >= 500:
        return "retryable_http"
    return "http_error"


def retry_delay(settings: Settings, attempt_number: int) -> float:
    return settings.retry_delays[attempt_number - 1]


class DeliveryWorker:
    def __init__(self, conn_factory, settings: Settings):
        self._conn_factory = conn_factory
        self.settings = settings

    async def tick(self) -> int:
        claimed: list[store.ClaimedDelivery] = []
        excluded: set[str] = set()
        while len(claimed) < self.settings.max_concurrency:
            conn = self._conn_factory()
            try:
                item = store.claim_due_delivery(
                    conn, time.time(), excluded, self.settings.claim_lease_seconds
                )
            finally:
                conn.close()
            if item is None:
                break
            claimed.append(item)
            excluded.add(item.endpoint_id)
        if not claimed:
            return 0
        await asyncio.gather(*(self._attempt(item) for item in claimed))
        return len(claimed)

    async def run_forever(self) -> None:
        try:
            while True:
                processed = await self.tick()
                await asyncio.sleep(0 if processed else self.settings.tick_interval)
        except asyncio.CancelledError:
            return

    async def _attempt(self, item: store.ClaimedDelivery) -> None:
        try:
            validate_url(item.url, self.settings.receiver_origin)
        except PolicyError as exc:
            self._finish(
                item,
                outcome="policy_error",
                http_status=None,
                excerpt=str(exc),
                next_due_at=None,
                terminal_status="failed",
            )
            return
        body = item.event_payload.encode()
        timestamp = int(time.time())
        headers = {
            "X-Webhook-Delivery-Id": item.id,
            "X-Webhook-Timestamp": str(timestamp),
            "X-Webhook-Signature": signing.signature_header(
                item.secret, item.id, timestamp, body
            ),
        }
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.request_timeout, follow_redirects=False
            ) as client:
                response = await client.post(item.url, content=body, headers=headers)
            status = response.status_code
            outcome = classify_response(status)
            excerpt = response.text[:1024]
            if outcome == "success":
                self._finish(
                    item,
                    outcome=outcome,
                    http_status=status,
                    excerpt=excerpt,
                    next_due_at=None,
                    terminal_status="succeeded",
                )
            elif outcome == "retryable_http":
                self._retry_or_fail(item, outcome, status, excerpt)
            else:
                self._finish(
                    item,
                    outcome=outcome,
                    http_status=status,
                    excerpt=excerpt,
                    next_due_at=None,
                    terminal_status="failed",
                )
        except httpx.TimeoutException as exc:
            self._retry_or_fail(item, "timeout", None, str(exc))
        except httpx.HTTPError as exc:
            self._retry_or_fail(item, "transport_error", None, str(exc))

    def _retry_or_fail(
        self, item: store.ClaimedDelivery, outcome: str, http_status: int | None, excerpt: str
    ) -> None:
        if item.attempt_number < 3:
            next_due_at = time.time() + retry_delay(self.settings, item.attempt_number)
            self._finish(
                item,
                outcome=outcome,
                http_status=http_status,
                excerpt=excerpt,
                next_due_at=next_due_at,
                terminal_status=None,
            )
        else:
            self._finish(
                item,
                outcome=outcome,
                http_status=http_status,
                excerpt=excerpt,
                next_due_at=None,
                terminal_status="failed",
            )

    def _finish(
        self,
        item: store.ClaimedDelivery,
        outcome: str,
        http_status: int | None,
        excerpt: str | None,
        next_due_at: float | None,
        terminal_status: str | None,
    ) -> None:
        conn = self._conn_factory()
        try:
            store.complete_attempt(
                conn,
                item.id,
                item.started_at,
                outcome,
                http_status,
                excerpt,
                next_due_at,
                terminal_status,
            )
        finally:
            conn.close()

import html
import time
from dataclasses import dataclass, field

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.signing import verify

SLOW_DEFAULT_SECONDS = 3.0
BEHAVIORS = {"success", "fail_once", "always_fail", "slow", "slow_fail", "redirect"}


@dataclass
class ReceiverConfig:
    slug: str
    secret: str
    behavior: str
    slow_seconds: float = SLOW_DEFAULT_SECONDS


@dataclass
class ReceiverState:
    configs: dict[str, ReceiverConfig] = field(default_factory=dict)
    seen: set[str] = field(default_factory=set)
    failures: dict[str, int] = field(default_factory=dict)
    requests: list[dict] = field(default_factory=list)


def _parse_behavior(raw: str) -> str:
    if raw in BEHAVIORS:
        return raw
    if raw.startswith("fail_count:"):
        try:
            int(raw.split(":", 1)[1])
        except ValueError:
            raise ValueError("invalid fail_count behavior")
        return raw
    raise ValueError("unknown behavior")


def create_receiver_app() -> FastAPI:
    state = ReceiverState()
    app = FastAPI(title="Demo webhook receiver")

    @app.post("/api/config")
    async def configure(request: Request):
        body = await request.json()
        try:
            behavior = _parse_behavior(str(body.get("behavior", "success")))
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        slug = str(body.get("slug", ""))
        secret = str(body.get("secret", ""))
        if not slug or not secret:
            return JSONResponse(status_code=400, content={"error": "slug and secret required"})
        slow_seconds = float(body.get("slow_seconds", SLOW_DEFAULT_SECONDS))
        state.configs[slug] = ReceiverConfig(
            slug=slug, secret=secret, behavior=behavior, slow_seconds=slow_seconds
        )
        return {"configured": slug, "behavior": behavior}

    @app.post("/api/reset")
    async def reset():
        state.configs.clear()
        state.seen.clear()
        state.failures.clear()
        state.requests.clear()
        return {"reset": True}

    @app.get("/api/requests")
    async def requests_log():
        return {"items": state.requests}

    @app.post("/webhooks/{slug}")
    async def receive(slug: str, request: Request):
        config = state.configs.get(slug)
        if config is None:
            return JSONResponse(status_code=404, content={"error": "unknown slug"})
        body = await request.body()
        delivery_id = request.headers.get("x-webhook-delivery-id", "")
        timestamp_header = request.headers.get("x-webhook-timestamp", "")
        signature_header = request.headers.get("x-webhook-signature", "")
        received_at = time.time()
        verified = bool(delivery_id and timestamp_header and signature_header) and verify(
            config.secret, delivery_id, timestamp_header, signature_header, body, now=int(received_at)
        )
        entry = {
            "delivery_id": delivery_id,
            "verified": verified,
            "duplicate": False,
            "received_at": received_at,
            "body": body.decode(errors="replace"),
        }
        state.requests.append(entry)
        if not verified:
            return JSONResponse(status_code=401, content={"error": "signature verification failed"})

        duplicate = delivery_id in state.seen
        entry["duplicate"] = duplicate
        if duplicate:
            return {"duplicate": True}

        behavior = config.behavior
        if behavior == "redirect":
            return RedirectResponse("/webhooks/elsewhere", status_code=302)
        if behavior == "slow":
            await anyio.sleep(config.slow_seconds)
        if behavior == "slow_fail":
            await anyio.sleep(config.slow_seconds)
            return JSONResponse(status_code=500, content={"error": "scripted failure"})
        if behavior == "always_fail":
            return JSONResponse(status_code=500, content={"error": "scripted failure"})
        if behavior == "fail_once":
            count = state.failures.get(delivery_id, 0) + 1
            state.failures[delivery_id] = count
            if count == 1:
                return JSONResponse(status_code=500, content={"error": "scripted first failure"})
        if behavior.startswith("fail_count:"):
            limit = int(behavior.split(":", 1)[1])
            count = state.failures.get(delivery_id, 0) + 1
            state.failures[delivery_id] = count
            if count <= limit:
                return JSONResponse(status_code=500, content={"error": "scripted failure"})
        state.seen.add(delivery_id)
        return {"duplicate": False}

    @app.get("/", response_class=HTMLResponse)
    async def index():
        rows = "".join(
            f"<tr><td>{html.escape(entry['delivery_id'])}</td>"
            f"<td>{'verified' if entry['verified'] else 'rejected'}</td>"
            f"<td>{'duplicate' if entry['duplicate'] else 'new'}</td>"
            f"<td><code>{html.escape(entry['body'][:200])}</code></td></tr>"
            for entry in reversed(state.requests)
        )
        configs = "".join(
            f"<li>{html.escape(slug)} → {html.escape(cfg.behavior)}</li>"
            for slug, cfg in state.configs.items()
        )
        return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Demo webhook receiver</title>
<style>body{{font-family:-apple-system,system-ui,sans-serif;margin:24px;color:#071437}}
table{{border-collapse:collapse}}td,th{{border:1px solid #d9dde8;padding:6px 10px;font-size:14px}}
code{{white-space:pre-wrap}}</style></head>
<body><h1>Demo webhook receiver</h1>
<form id="config"><input name="slug" placeholder="path slug" required>
<input name="secret" placeholder="whsec_…" required>
<select name="behavior"><option>success</option><option>fail_once</option>
<option>always_fail</option><option>slow</option><option>slow_fail</option>
<option>redirect</option><option>fail_count:3</option></select>
<button type="submit">Save</button></form>
<p id="status"></p><h2>Configured paths</h2><ul>{configs}</ul>
<h2>Received requests</h2>
<table><tr><th>Delivery</th><th>Verification</th><th>Side effect</th><th>Body</th></tr>{rows}</table>
<script>document.getElementById('config').addEventListener('submit', async (e) => {{
e.preventDefault(); const data = Object.fromEntries(new FormData(e.target));
const response = await fetch('/api/config', {{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify(data)}});
document.getElementById('status').textContent = response.ok ? 'Saved. Reload to see config.' : 'Rejected.';
}});</script></body></html>"""

    return app


app = create_receiver_app()

import html
import time
from dataclasses import dataclass, field

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.signing import verify

SLOW_DEFAULT_SECONDS = 3.0
MAX_LOGGED_REQUESTS = 500
BEHAVIORS = {"success", "fail_once", "always_fail", "slow", "slow_fail", "redirect"}


@dataclass
class ReceiverConfig:
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


def _mask(secret: str) -> str:
    return f"••••{secret[-4:]}" if len(secret) > 4 else "••••"


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
        secret = str(body.get("secret", ""))
        if not secret:
            return JSONResponse(status_code=400, content={"error": "secret required"})
        slow_seconds = float(body.get("slow_seconds", SLOW_DEFAULT_SECONDS))
        state.configs[secret] = ReceiverConfig(
            secret=secret, behavior=behavior, slow_seconds=slow_seconds
        )
        return {"configured": _mask(secret), "behavior": behavior}

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

    def _match_config(delivery_id: str, timestamp_header: str, signature_header: str, body: bytes, now: int):
        for config in state.configs.values():
            if verify(config.secret, delivery_id, timestamp_header, signature_header, body, now=now):
                return config
        return None

    @app.post("/webhooks/{path}")
    async def receive(path: str, request: Request):
        body = await request.body()
        delivery_id = request.headers.get("x-webhook-delivery-id", "")
        timestamp_header = request.headers.get("x-webhook-timestamp", "")
        signature_header = request.headers.get("x-webhook-signature", "")
        received_at = time.time()
        config = None
        if delivery_id and timestamp_header and signature_header:
            config = _match_config(
                delivery_id, timestamp_header, signature_header, body, int(received_at)
            )
        entry = {
            "delivery_id": delivery_id,
            "verified": config is not None,
            "duplicate": False,
            "received_at": received_at,
            "body": body.decode(errors="replace"),
        }
        state.requests.append(entry)
        if len(state.requests) > MAX_LOGGED_REQUESTS:
            del state.requests[:-MAX_LOGGED_REQUESTS]
        if config is None:
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
            f"<tr><td><code>{html.escape(entry['delivery_id'])}</code></td>"
            f"<td><span class='badge {'ok' if entry['verified'] else 'bad'}'>"
            f"{'verified' if entry['verified'] else 'rejected'}</span></td>"
            f"<td><span class='badge neutral'>"
            f"{'duplicate' if entry['duplicate'] else 'new'}</span></td>"
            f"<td class='body-cell'>{html.escape(entry['body'][:200])}</td></tr>"
            for entry in reversed(state.requests)
        )
        configs = "".join(
            f"<li>{html.escape(_mask(secret))} → {html.escape(cfg.behavior)}</li>"
            for secret, cfg in state.configs.items()
        )
        return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Demo webhook receiver</title>
<style>
:root{{--navy:#071437;--muted:#69748b;--purple:#9900ff;--border:#e4e8f1;--ok:#15803d;--err:#dc2626;--okbg:#e7f6ec;--errbg:#fdeaea;--bg:#f4f6fb}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--navy);font-family:Inter,-apple-system,system-ui,Segoe UI,sans-serif;font-size:14px}}
.wrap{{max-width:1080px;margin:0 auto;padding:28px 24px 64px}}
header{{display:flex;align-items:center;gap:12px;margin-bottom:20px}}
.mark{{width:40px;height:40px;border-radius:12px;background:var(--purple);color:#fff;font-weight:700;font-size:20px;display:grid;place-items:center}}
h1{{font-size:20px;margin:0}} .sub{{color:var(--muted);font-size:12px;margin:0}}
.card{{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 1px 2px rgba(7,20,55,.05),0 12px 28px -20px rgba(7,20,55,.28);padding:20px;margin-bottom:20px}}
h2{{font-size:16px;margin:0 0 4px}} .hint{{color:var(--muted);font-size:13px;margin:0 0 14px}}
form{{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}}
input,select{{border:1px solid #d3daea;border-radius:9px;padding:8px 10px;font:inherit;font-size:13px}}
input:focus,select:focus{{outline:2px solid var(--purple);outline-offset:1px;border-color:var(--purple)}}
button{{background:var(--purple);border:1px solid var(--purple);color:#fff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}}
button:hover{{background:#7c00d1}}
#status{{font-size:13px;color:var(--muted)}}
ul.secrets{{list-style:none;margin:0;padding:0;display:flex;gap:8px;flex-wrap:wrap}}
ul.secrets li{{background:#f4e8ff;border:1px solid #dec2ff;color:#7c00d1;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{text-align:left;color:var(--muted);font-weight:600;font-size:12px;border-bottom:1px solid var(--border);padding:8px 10px}}
td{{border-bottom:1px solid var(--border);padding:8px 10px;vertical-align:top}}
td code{{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f3f5fa;border-radius:6px;padding:1px 6px}}
.badge{{border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:600}}
.ok{{background:var(--okbg);color:var(--ok)}} .bad{{background:var(--errbg);color:var(--err)}} .neutral{{background:#eef1f6;color:#64748b}}
.body-cell{{max-width:420px;overflow-wrap:anywhere;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#3b4763}}
</style></head>
<body><div class="wrap">
<header><span class="mark">R</span><div><h1>Demo webhook receiver</h1>
<p class="sub">Verifies HMAC signatures, dedupes by delivery id, and scripts success or failure.</p></div></header>
<div class="card"><h2>Connect a webhook secret</h2>
<p class="hint">Create an endpoint in the dashboard first — its one-time signing secret appears there once, at creation. Paste it here, choose how this receiver responds, and save.</p>
<form id="config"><input name="secret" placeholder="whsec_… one-time secret" required>
<select name="behavior"><option value="success">Always succeed</option>
<option value="fail_once">Fail once, then succeed</option>
<option value="always_fail">Always fail</option></select>
<button type="submit">Save secret</button><span id="status"></span></form>
<h2 style="margin-top:18px">Connected secrets</h2>
<ul class="secrets">{configs}</ul></div>
<div class="card"><h2>Received requests</h2>
<p class="hint">Every inbound request with its verification and dedupe result.</p>
<table><tr><th>Delivery</th><th>Verification</th><th>Side effect</th><th>Body</th></tr>{rows}</table></div>
</div>
<script>document.getElementById('config').addEventListener('submit', async (e) => {{
e.preventDefault(); const data = Object.fromEntries(new FormData(e.target));
const response = await fetch('/api/config', {{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify(data)}});
document.getElementById('status').textContent = response.ok ? 'Saved — reload to see it listed.' : 'Rejected.';
}});</script></body></html>"""

    return app


app = create_receiver_app()

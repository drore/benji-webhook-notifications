---
title: AI usage note — lean Benji webhook attempt
date_created: 2026-09-27
status: living
tags: [benji, take-home, ai-usage]
---

# AI usage note

This project is AI-assisted. Dror (engineering manager) owns the product direction, made every specification decision, and approved the design and plan; the agent produced analysis, code, and tests under his review.

The lean design implemented here builds directly on the specification Dror developed and reviewed in the earlier Benji attempt (`benji-task`). The shared, already-settled contracts are: endpoint-owned event-type subscriptions with fan-out across eligible endpoints, HMAC-SHA256 delivery signing with a one-time secret, ±300s timestamp window, and delivery-id deduplication; exponential backoff of 2s then 4s across three attempts with replay; server-generated event IDs with a separate sender idempotency key; the loopback-only destination policy; and the safe `{code, message}` error envelope. This attempt re-derives the product shape with a minimal endpoint model (no workflow/version layer) and a simpler single-process architecture.

- **Environment:** opencode CLI with the `deepseek-flash` model. The work was executed as specification-driven, test-driven slices with a commit per slice.
- **Trail:** the specification (`docs/spec/design.md`), the implementation plan (`docs/plan/implementation-plan.md`), the worklog (`docs/process/worklog.md`), and the git history. The execution ledger is scratch and git-ignored.
- **Limits:** no independent human review during the build; a fresh-context review of the whole branch follows the final task. Local checks do not establish production readiness.

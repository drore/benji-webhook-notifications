---
title: AI usage note and working profile — Benji webhook take-home
date_created: 2026-09-27
last_updated: 2026-09-28
status: living
tags: [benji, take-home, ai-usage, process]
---

# AI usage note

This take-home is AI-assisted. The note covers both Benji attempts — the spec-first attempt in `benji-task` (built on its `codex/benji-first-rope` branch) and this lean build — and describes how I work with AI rather than transcribing prompts. Each claim points at an artifact in one of the two repositories so a reviewer can check it.

**The short version.** I treat an agent as a fast, tireless, literal-minded engineer: it needs a contract, a boundary, and a reviewer. I keep the contract, the decisions, the definition of done, and the acceptance evidence on my side, and I let the agent generate the volume — analysis, code, tests, documentation — under review. The two attempts differ mainly in how much process I bought: the first spent its early days on specification and journaling before any code existed; the second reached a working local candidate in about 3.5 focused hours with the same discipline and a leaner artifact set.

## How I work with AI

**1. Contract before code, and the decisions stay mine.** I direct the product shape rather than accepting the first proposal: the event journey dashboard, the named workflow parent, server-generated queue event IDs with a separate sender key, and exponential delivery backoff were my directions, and the requirement that a replaced subscription stays linked to its predecessor came from my need to compare versions. I then require the agent to separate *proposed* from *accepted* so nothing becomes a requirement by assumption.

*Evidence:* `benji-task`'s decision register (`docs/process/decisions-and-tradeoffs.md`, D-01…D-61) and the journal's decision log; this repo's `docs/spec/design.md` labels every clause **Required** (from the assignment) or **Chosen** (approved in review), and the spec is frozen on approval. When I wanted the journal out of this submission, the change was committed as an owner-directed removal with the prior specification attributed (`f89f094`).

**2. I review proposals one at a time, and I interrogate them before approving.** "Let's review these choices one by one" is how the first attempt settled the spec. Before accepting a proposal I test whether it survives a naive question about the edge case it implies — "The issue here is with queued events?", "Retrying how?", "What do you mean by *resolving*?" — and I expect the answer to name the case, not restate the proposal.

*Evidence:* `benji-task` journal, turns 15–17, 22, 13.

**3. Rope first, then the bridge.** Build the smallest real path across the whole system before refining any part of it: the analogy I gave the agent was throwing a rope between two banks before building the golden bridge, and carving the statue's large form before the nose. The same rule applies at feature scale.

*Evidence:* `benji-task` journal turns 9–10; this repo's plan is 15 TDD tasks that begin with a skeleton and a first end-to-end signed delivery, each task naming interfaces, the failing test, and the commit. The lean attempt deliberately drops the workflow/version layer of the first attempt while reusing its settled contracts, and says so in both `README.md` and `docs/spec/design.md`.

**4. Evidence over claims, at the lowest faithful layer.** A green test is evidence only for what it asserts. Integration tests run against a real local receiver over real HTTP; delivery behavior is proven with observed backoff, not mocks; the final candidate is verified with a browser suite, a documented boot smoke test, and a fresh-clone rehearsal. Local proof is never reported as production proof.

*Evidence:* `benji-task` `docs/process/tdd-log.md` distinguishes a setup red from a behavioral red; `final-verification-evidence.md` maps every requirement to executable evidence on a named candidate commit; this repo's plan records the execution evidence, and the README says plainly that nothing has been pushed or submitted.

**5. Independent review is a standing requirement — and I adjudicate it.** I don't treat the agent's own review as independent, and I don't treat an external review as authoritative either. Reviewers were asked to challenge architecture, concurrency, and security; their findings were reproduced, fixed test-first, and recorded, including the ones I chose not to act on.

*Evidence:* this repo's fresh-context whole-branch review of `07719b0..bc44b1a` found 2 Critical and 4 Important issues (replay cycle budget, malformed-URL 500s, NaN/deep-nesting payloads, wrong error code on body-parse failures, a disable/resume race, non-polling detail views); all were fixed with tests written first in `e6ff215`, and nine Minor findings were deferred to the git-ignored execution ledger. The earlier attempt ran two read-only Codex reviews plus an external Gemini review that I evaluated claim by claim: I accepted the Workflow → Destinations → Endpoint Versions hierarchy it proposed, rejected its separate-worker proposal in favor of the FastAPI lifespan worker, corrected its false TypeScript version claim against the lockfile and official releases, and kept implementation paused until the reconciliation was written down. A later independent release review found that binding to `127.0.0.1` did not reject a foreign `Host` header; the fix landed with negative tests that failed first.

**6. Remote and irreversible effects need my explicit approval, written into the repo.** The agent may not push, publish, deploy, or spend on its own initiative. After the agent pushed follow-up documentation on the strength of the original repository request, I set the boundary — "do not push unless I ask you to or you feel that we need to and get my approval" — and it now lives in `AGENTS.md` so it survives fresh contexts. Submission to the recruiter is a separate gate from a locally verified candidate, and in the first attempt I stopped the work before submission rather than let it drift there.

*Evidence:* `benji-task` decision `D-05` and journal turn 24; this repo's `AGENTS.md` ("Do not push, publish, deploy, spend, or make destructive changes without Dror's explicit authorization"), plan handoff ("do not push"), and spec `SUB-01`.

**7. I instrument the collaboration.** I measure an agent the way I'd manage an engineer: pace, cost, and what it actually produced. When the first attempt stalled in documentation I asked why it was taking so long; when I wanted more than intuition, I had the agent build a token-expenditure record and a focused-time worklog, both marked as snapshots rather than exact accounting.

*Evidence:* `benji-task` `docs/process/token-expenditure.md` (per-session usage with cached-input accounting, no invented prices, and an explicit note that external Gemini usage is excluded); this repo's `docs/process/worklog.md` (~3h35m focused against the assignment's one-day constraint, rounded and labeled as such).

**8. I document the visible process, not invented reasoning.** The journal preserves my messages verbatim and summarizes each assistant turn in one short paragraph, keeps decisions and open questions current, and is explicit that it does not claim to contain private model reasoning. It is maintained so I can present and defend the process later without reconstructing it from memory.

*Evidence:* `benji-task`'s `docs/process/developer-journal.md` (81 recorded turns on the build branch, a maintenance rule, and an Obsidian mirror with readback) plus its `engineering-principles-audit.md`, `security-review.md`, and `potential-improvements.md`.

## Where this costs me

- **Process is not free.** The first attempt spent its early effort on spec, stories, readiness, and journaling, and was paused with little runnable code. The honest lesson is in the second attempt: the same gates, a smaller reviewer-facing artifact set, and a working candidate in a single evening.
- **The rules only hold when they are written down.** Verbal expectations don't survive a fresh context, so standing constraints belong in `AGENTS.md` and in the spec, not in a chat.
- **Verified review depth is uneven.** Fixes after the whole-branch review were not re-reviewed by a fresh context, and the human visual pass over the dashboard walkthrough is still outstanding.
- **Local is not production.** Every safeguard here is exercised on loopback with one fixed customer; the production gaps (authentication, public HTTPS destination policy with DNS validation, secret rotation, retention, rate limits, horizontal dispatch) are listed in the spec rather than implied away.

## AI trail for this attempt

- **Environment:** opencode CLI with the `deepseek-flash` model, used as specification-driven, test-driven slices with a commit per slice; the earlier attempt used Codex (main chat plus delegated workers) against a frozen spec and an executable definition of done.
- **Artifacts:** specification (`docs/spec/design.md`), implementation plan (`docs/plan/implementation-plan.md`), worklog (`docs/process/worklog.md`), this note, and the git history — from an empty repository to the candidate, one commit per planned task plus the review-fix and owner-requested UX commits. The execution ledger is scratch and git-ignored.
- **Recorded results:** `uv run pytest -q` → 58 passed and `cd frontend && npm test` → 24 passed (5 files), both re-verified on 2026-09-28; `npm run build` → success; `python3 scripts/run_e2e.py` → 10 Playwright browser tests passed, last recorded on 2026-09-27; the documented boot commands smoke-tested on spare ports. The dashboard journey renders on a read-only Vue Flow canvas, endpoints carry server-generated URLs, and the receiver is configured by one-time secret only.
- **Limits:** the manual browser walkthrough has not yet been run end-to-end by a human, the E2E suite has not been re-run since the last recorded revision, no push or submission has occurred, and local checks do not establish production readiness.

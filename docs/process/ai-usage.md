---
title: AI usage note and working profile — Benji webhook take-home
date_created: 2026-09-27
last_updated: 2026-09-28
status: living
tags: [benji, take-home, ai-usage, process]
---

# AI usage note

This take-home is AI-assisted. The note covers both Benji attempts — the spec-first attempt in `benji-task` (built on its `codex/benji-first-rope` branch) and this lean build — and describes how I work with AI rather than transcribing prompts. Each claim points at an artifact in one of the two repositories; where the evidence is my own words in `benji-task`'s developer journal, I reproduce the excerpt here verbatim, typos included, with its turn number (turns past 26 come from the `codex/benji-first-rope` copy of that journal).

**The short version.** I treat an agent as a fast, tireless, literal-minded engineer: it needs a contract, a boundary, and a reviewer. I keep the contract, the decisions, the definition of done, and the acceptance evidence on my side, and I let the agent generate the volume — analysis, code, tests, documentation — under review. The two attempts differ mainly in how much process I bought: the first spent its early days on specification and journaling before any code existed; the second reached a working local candidate in about 3.5 focused hours with the same discipline and a leaner artifact set.

## How I work with AI

**1. Spec before plan, plan before code.**

> Turn 12 — We shouldn’t jump to implementation before writing a detailed development plan. We cannot write a detailed development plan before finalizing spec. I think a good way to see if our spec is ready is to write some user stories and see if the spec addresses every part of them

That became a real gate rather than a slogan: the specification stayed marked not-ready until every user story had one accepted outcome for its normal, duplicate, failure, and recovery paths, and the detailed plan was written only after it passed. The lean attempt then inherited a frozen spec and was allowed to change the product shape only deliberately — dropping the workflow/version layer while reusing the settled delivery, signing, and identity contracts.

*Evidence:* `benji-task` journal turn 12 and its `docs/spec/spec-design-user-stories.md` readiness gate; this repo's `docs/spec/design.md` (frozen on approval) and `docs/plan/implementation-plan.md`.

**2. The decisions stay mine, and I take them one at a time.**

> Turn 15 — Let's review these choices one by one

> Turn 18 — That is, maybe a webhook / endpoint is linked to a higher level entity - for example "Updating loyalty points - company A"

> Turn 19 — Yes so each workflow (let’s call those workflows unless you have a better idea) has only one active endpoint at a time

> Turn 21 — Let’s imitate a queue so the event would get a unique identifier upon entering the “queue”

> Turn 17 — Ok, immutable webhook subs are fine with me, as long as we can say that now obsolete sub A is related to the newer sub B that replaced it, for comparison, evals etc.

The named workflow parent, one active version per workflow, queue-assigned event IDs, and version lineage were my directions. When I accepted the immutability proposal I attached a requirement of my own — the replacement link between an obsolete subscription and its successor, for later comparison.

*Evidence:* `benji-task`'s decision register (`docs/process/decisions-and-tradeoffs.md`, D-01…D-61) and the journal's decision log; this repo's `docs/spec/design.md` labels every clause **Required** (from the assignment) or **Chosen** (approved in review). When I wanted the journal out of this submission, the change was committed as an owner-directed removal with the prior specification attributed (`f89f094`).

**3. I interrogate a proposal before I approve it.**

> Turn 13 — What do you mean by “resolving”? Adjusting the spec?

> Turn 16 — The issue here is with queued events?

> Turn 22 — "Retrying with the same key and content" - Retrying how?

Each question named the case a proposal had left unresolved — what resolving a gap actually changes, which deliveries a configuration change affects, and how a resend differs from a delivery retry — and the answer had to name it too. A proposal that only restated itself was sent back.

*Evidence:* `benji-task` journal turns 13, 16, and 22, and the resend-versus-retry and disable-versus-cutover clauses they produced in that repo's decision register.

**4. I raise the unglamorous requirements myself.**

> Turn 11 — We also need to keep in mind: security, scalability (once this goes to production, also how to test locally)

> Turn 25 — Retries should have exponential deck-off

> Turn 26 — How will the admin or other user with relevant permissions be able to investigate a failure of delivery

Security with a local way to test it, exponential backoff for delivery retries, and a real operator investigation path entered the specification as my requirements, before any code existed. The production and permission questions were answered as design, and the demo's no-login, loopback-only boundary stayed explicit instead of implied.

*Evidence:* `benji-task`'s `docs/spec/spec-architecture-security-and-scale.md`; this repo's `docs/spec/design.md` sections 7 and 12, `FR-04` (bounded exponential attempts), and the delivery-inspection surface in section 8 (`FR-06`, `FR-10`).

**5. Rope first, then the bridge.**

> Turn 9 — My preferred way to taking assignments is SDD-TDD. Also - when building, I rather build in small parts from  - while first making stuff work and only after enhancing. The analogy I use is of building a bridge between two banks. First we just throw a rope so we can go from side to side, and only then start beautifying and building our golden bridge. Is the approach clear?Also - we should plan and later work in small iterations

> Turn 10 — by "rope" between both sides of the bank I can mean for a small task and it can also mean for the entire task.  another analogy may be of a marble statue - you are not refining the nose before you carved the bigger pieces to have a general structure of it.

The rope applies at both scales, so the first slice had to cross the whole system — browser to API to durable store to signed HTTP to a visible status — before any component was polished.

*Evidence:* `benji-task` journal turns 9–10 and its `docs/spec/spec-process-sdd-tdd-iterations.md`; this repo's plan runs 15 TDD tasks from a skeleton and a first end-to-end signed delivery onward, and the lean attempt states in `README.md` and `docs/spec/design.md` that it re-derives the product shape from the earlier specification's settled contracts.

**6. Evidence over claims, at the lowest faithful layer.** A green test is evidence only for what it asserts. Integration tests run against a real local receiver over real HTTP; delivery behavior is proven with observed backoff, not mocks; the final candidate is verified with a browser suite, a documented boot smoke test, and a fresh-clone rehearsal. Local proof is never reported as production proof.

*Evidence:* `benji-task`'s `docs/process/tdd-log.md` separates a setup red from a behavioral red, and its `final-verification-evidence.md` maps every assignment requirement to executable evidence on a named candidate commit; this repo's plan records the execution evidence and its remaining limits, and the README says plainly that nothing has been pushed or submitted.

**7. Independent review is a standing requirement — and I adjudicate the findings.**

> Turn 40 — This is a review by Gemini: # Architecture and Development Plan Review: Benji Webhook Take-Home

I don't treat the agent's self-review as independent, and I don't treat an external review as authoritative. Findings are reproduced, fixed test-first, and recorded — including the ones I reject. From the review quoted above I accepted the Workflow → Destinations → Endpoint Versions hierarchy (`D-32`), rejected its separate-worker proposal in favor of the FastAPI lifespan worker (`D-33`), and corrected its false TypeScript version claim against the installed package and the official release (`D-35`).

*Evidence:* this repo's fresh-context whole-branch review of `07719b0..bc44b1a` found 2 Critical and 4 Important issues (replay cycle budget, malformed-URL 500s, NaN/deep-nesting payloads, wrong error code on body-parse failures, a disable/resume race, non-polling detail views); all were fixed with tests written first in `e6ff215`, and nine Minor findings were deferred to the git-ignored execution ledger. In `benji-task`, two read-only Codex reviews plus the Gemini review above produced the disposition table in `docs/process/decisions-and-tradeoffs.md`, and a later independent release review found that binding the service to `127.0.0.1` did not reject a foreign `Host` header; that fix also landed with negative tests that failed first.

**8. Remote and irreversible effects need my explicit approval, written into the repo.**

> Turn 24 — You write that you "pushed the changes". Please do not push unless I ask you to or you feel that we need to and get my approval

> Turn 79 — continue with the development plan - stop before submission

The agent may not push, publish, deploy, or spend on its own initiative. Both boundaries live in repository rules rather than in a chat, so they survive a fresh context: recruiter submission stays a separate gate from a locally verified candidate, and it did not happen in either attempt.

*Evidence:* `benji-task` decision `D-05` and journal turns 24 and 79; this repo's `AGENTS.md` ("Do not push, publish, deploy, spend, or make destructive changes without Dror's explicit authorization"), the plan handoff ("do not push"), and spec `SUB-01`.

**9. I instrument and archive the collaboration.**

> Turn 6 — Also - and this please maintain both in the folder (docs/process) and in obsidian - a developer journal that keeps our decisions and also a full conversation history (my side fully, your side with no more then a short paragraph per turn) - this is for me to be able to present my CoT and process later when asked to

> Turn 8 — why is this taking so long?

I measure an agent the way I'd manage an engineer — pace, cost, and what it actually produced — and I keep a record I can present later instead of reconstructing it from memory. The journal stores my messages verbatim, summarizes each assistant turn in one short paragraph, and states that it does not claim to contain private model reasoning.

*Evidence:* `benji-task`'s `docs/process/developer-journal.md` (81 recorded turns on the build branch, a maintenance rule, and an Obsidian mirror with readback), its `token-expenditure.md` (per-session usage with cached-input accounting, no invented prices, and external Gemini usage marked as excluded), and its `engineering-principles-audit.md`, `security-review.md`, and `potential-improvements.md`; this repo's `docs/process/worklog.md` (~3h35m focused against the assignment's one-day constraint, rounded and labeled as such).

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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the durable operating contract for coding agents in this repo. Read it before non-trivial changes. This file is a quick orientation; `AGENTS.md` is authoritative for boundaries, product direction, and definition of done.

## Commands

```bash
npm run dev                # Next.js dev server (use --hostname 127.0.0.1 --port 4317 for the documented demo URL)
npm run lint               # ESLint
npm test                   # Vitest unit/policy tests (excludes *.integration.test.ts)
npm run test:integration   # Vitest integration tests against the local PostgreSQL container
npm run build              # next build
npm run verify             # lint + unit tests + integration tests + build + git diff --check (must pass before commit)
npm run eval               # Run the 30-case AI quality baseline (lib/evaluation.test.ts)

npm run db:up              # Start the local PostgreSQL 17 container (docker-compose.yml)
npm run db:down            # Stop the local PostgreSQL container
npm run db:migrate         # Apply ordered SQL migrations from db/migrations/
npm run db:seed            # Seed users, insights, merchant settlements, source ingestion, and settlement imports
npm run settlements:refresh  # Re-run synthetic merchant settlement statement classification
```

Run a single Vitest file: `npx vitest run lib/reconciliation.test.ts` (or `--config vitest.integration.config.ts` for `*.integration.test.ts`).

The full local setup is `npm install && cp .env.example .env.local && npm run db:up && npm run db:migrate && npm run db:seed && npm run dev -- --hostname 127.0.0.1 --port 4317`. Demo users (`admin@`, `analyst@`, `viewer@payops.local`) all use password `PayOpsDemo123!`.

## Architecture

This is a Next.js 16 (App Router) + React 19 + PostgreSQL 17 modular monolith. Frontend (CSV parsing, interaction state) lives in `app/` and `components/`; the server owns reconciliation, persistence, authorization, and audit writes.

**Backend module pattern (lib/modules/).** API routes are thin: they handle auth, JSON, and HTTP responses. They import the domain module they serve and translate `DomainError` (from `lib/modules/errors.ts`) into HTTP through `lib/api-errors.ts`. Each domain has the shape:

```text
API route -> domain service (validation, state policy, audit orchestration)
          -> domain repository (SQL only)
          -> lib/db.ts (shared pg pool, query helper, transaction boundary)
```

Domains under `lib/modules/`: `reconciliation`, `cases`, `investigations`, `evaluations`, `payment-workflows`, `provider-events`, `source-ingestion`, `notifications`, `insights`, `settlement-control`, `close-control`, `remediation-programs`, `merchant-settlements`, `settlement-imports`, `manual-matches`, `refund-allocations`, `ledger`, `audit`, `system`. Cross-domain calls go through public module exports — do not recreate a central repository, and do not put business orchestration in route handlers. Add a service when validation, state transitions, cross-repository coordination, or audit writes are needed.

**Deterministic vs. AI split.** The product's central design rule is that financial truth comes from deterministic TypeScript and persisted source evidence — never from a model. `lib/reconciliation.ts` calculates matches and exceptions; `lib/ai-investigator.ts` produces structured Zod-validated investigation drafts that require human approval. AI may not edit financial records, resolve cases, or contact providers. If `OPENAI_API_KEY` is missing, AI paths fall back to a labeled deterministic evidence-rules path.

**Shared infrastructure.** `lib/db.ts` (single pg pool + transaction boundary), `lib/access.ts` (Auth.js session + RBAC: `admin`/`analyst`/`viewer`), `lib/sla.ts` (4h/24h/72h SLA policy by priority), `lib/settlement-calendar.ts` + `lib/settlement-policy.ts` (synthetic IST cycle and Indian demo business-calendar rules), `lib/provider-adapters.ts` + `lib/provider-webhooks.ts` + `lib/provider-signatures.ts` (synthetic provider mapping, normalization, and HMAC signature contracts).

**Migrations.** `db/migrations/NNN_*.sql` are ordered and applied by `scripts/migrate.mjs`. Never rewrite an applied migration — add a new numbered one. Preserve existing data and constraints; update `.env.example` only with safe placeholders.

**Tenant scoping (non-negotiable).** Every protected database query is scoped by `organizationId`. Mutations require `admin` or `analyst`; audit reads require `admin`. The provider-webhook ingestion route is signed HMAC, idempotent, and stores hashes + normalized evidence — never raw payloads or provider credentials.

## What this product is (and is not)

PayOps is a portfolio MVP for Indian mid-market merchant finance / payment-ops teams **only** — not aggregator escrow/nodal reconciliation, not marketplace split-settlement, not generic "Indian payment ops," not support ops, not BNPL ops. `AGENTS.md` is authoritative on ICP; do not widen it in code, copy, or documentation.

All data is synthetic. It does not connect to live payment providers, banks, or payout rails, and cannot move money. Synthetic provider names (Razorpay-style, Cashfree-style, PayU-style), webhook contracts, settlement calendars, and close certificates are demo policies — do not imply real integration.

The wedge (per `gaps.md` review) is a **multi-PG settlement-exception desk for Indian merchants**: prove UTR / fee / GST / refund / chargeback / hold / bank-credit mismatches across 2–5 PGs before month close, and produce controller-ready evidence packets. The roadmap to get there (see `AGENTS.md`) is Source Ingestion Control Plane (shipped) → Matching Engine v2 (Slices 1–5 shipped) → Ledger Backbone v1 (Slices 6a + 6b shipped 2026-06-29) → **escalation (next)**. No new governance / dashboard / certificate / AI-review surfaces until escalation lands and real-file ingestion is credible — see "Do not add new governance surfaces" below.

The "PayOps Copilot" name is historical (repo + Vercel URL still resolve through it). User-facing surfaces now lead with **PayOps**; "Copilot" framing is downgraded because the AI is not load-bearing.

## Required checks before commit

`npm run verify` must pass. For DB changes, add a new numbered migration and test against the local PostgreSQL container. For AI changes, preserve structured Zod output, keep `store: false`, include model/prompt-version metadata where the schema supports it, test the deterministic fallback, and do not weaken human review. When a change is user-facing, walk the real browser journey before declaring done, and update every affected README/doc/architecture claim/measured count/roadmap line in the same change.

## Workflow orchestration

### 1. Plan first
- Enter plan mode for any non-trivial task — 3+ steps, cross-layer change (DB + API + UI), or an architectural decision (new module, new migration, new domain service).
- Write detailed specs upfront. Ambiguity in this repo costs disproportionately because of tenant scoping, audit, and the deterministic-vs-AI boundary.
- If something goes sideways (a migration touches more than expected, a test reveals a tenancy gap, an AI path drifts toward financial truth), STOP and re-plan. Do not push through.
- Use plan mode for verification too: state the exact journey you'll walk in the browser and the exact tests you'll run, not just what you'll build.

### 2. Subagent strategy
- Use subagents liberally to keep the main context clean.
- Offload exploration ("where is X scoped by organizationId?", "which routes call this service?"), parallel research, and audits to `Explore` or `general-purpose` agents.
- For complex multi-domain changes, run independent investigations in parallel — one subagent per domain (e.g., one mapping case-state transitions, one tracing audit writes).
- One concern per subagent. Give it the file paths, the question, and the expected report shape.

### 3. Self-improvement loop
- After any correction from the user, capture the pattern. Use the `auto memory` system (feedback type) — that's the durable channel for "next time, do X."
- Write the rule so future-you can apply it without re-deriving the why. Include the incident or reasoning that motivated it.
- Review relevant memories at the start of work in this repo before making non-trivial changes.

### 4. Verification before done
- Never mark a task complete without proving it works. "Tests pass" is necessary, not sufficient — for user-facing changes, walk the real browser journey at `http://127.0.0.1:4317`.
- Diff the actual behavior between `main` and your branch when relevant (e.g., reconciliation output, SLA classification, audit rows written).
- Ask: would a staff engineer approve this? Specifically: is every protected query scoped by `organizationId`? Does every mutation write an audit event? Does AI output go through Zod and human review?
- `npm run verify` is the floor, not the ceiling.

### 5. Demand elegance (balanced)
- For non-trivial changes, pause before declaring done: is there a more elegant way? In this repo, "more elegant" usually means pushing logic into the right layer — service vs. repository vs. route — rather than abstracting more.
- If a fix feels hacky (a guard added at the route, business logic leaking into a component, a one-off SQL query in a route handler), implement the elegant version instead.
- Skip this loop for genuinely simple fixes. Per `AGENTS.md`: smallest complete change. Don't over-engineer.

### 6. Autonomous bug fixing
- Given a bug report or a failing test, fix it. Don't ask for hand-holding. Read the logs, the failing assertion, the related code, and resolve it.
- Go fix failing CI / `verify` failures without being told how, unless the root cause is genuinely ambiguous between two product directions.
- The exception in this repo: if a fix would touch the deterministic-vs-AI boundary, tenant scoping, audit semantics, or roadmap direction, surface the call before acting.

## Task management

1. **Plan first**: for any non-trivial work, write a plan with checkable items (use `TaskCreate` or plan mode).
2. **Verify the plan**: check in with the user before starting implementation when scope or product direction is unclear.
3. **Track progress**: mark items complete as you go — don't batch.
4. **Explain changes**: brief high-level summary at each meaningful step, not running commentary.
5. **Capture lessons**: after corrections, write to memory (feedback type) so the lesson survives the conversation.

## Core principles

- **Simplicity first.** Smallest complete change across DB / API / UI / tests / docs. No drive-by refactors. If you wrote 200 lines and it could be 50, rewrite it. Ask: "would a senior engineer call this overcomplicated?"
- **No laziness.** Find root causes. No temporary fixes, no "TODO: revisit," no silent fallbacks that mask a real bug. Senior-engineer standards.
- **Minimal impact.** Changes touch only what's necessary. Don't introduce regressions in adjacent surfaces — especially tenant scoping, audit, and the AI safety boundary.

## Behavioral guardrails

These bias toward caution over speed. Use judgment for trivial fixes; apply rigorously for anything touching DB, audit, tenancy, or the AI boundary.

### Think before coding
- State assumptions explicitly. If uncertain, ask before implementing.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted, especially against scope creep into adjacent domains or premature governance surfaces (per `AGENTS.md` roadmap).
- If something is unclear — a tenancy boundary, a case state transition, an audit requirement, whether a path is deterministic-truth or AI-assistance — stop and name what's confusing.

### Surgical changes
- Touch only what the user asked for. Don't "improve" adjacent code, comments, or formatting in passing.
- Match existing module patterns (route → service → repository → `lib/db.ts`) and existing style even if you'd structure them differently. Drift adds review cost across `lib/modules/`.
- If your change orphans imports/variables/functions, remove them. Don't delete pre-existing dead code unless asked — flag it instead.
- The test: every changed line should trace to the user's request, or to a domain rule it forces (tenant scoping, audit write, AI safety, migration ordering).

### Goal-driven execution
Convert vague asks into verifiable goals before coding:
- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Unit + integration tests pass before and after, no behavior change."

For multi-step work, state the plan as `step → verification`:

```
1. Add migration NNN_*.sql           → verify: npm run db:migrate applies cleanly on the local container
2. Add domain service + repo method  → verify: unit test covers state transitions and tenancy
3. Wire API route + UI               → verify: browser journey at /operations as admin and analyst
4. Update docs + README counts       → verify: every measured number matches reality
```

Strong success criteria let you loop independently. "Make it work" forces constant clarification and produces over-scoped diffs.

### Self-check
These guardrails are working if:
- diffs contain fewer unrelated changes;
- fewer rewrites because of overcomplication;
- clarifying questions arrive before implementation, not after a wrong turn.

### Do not add new governance surfaces
No new dashboards, certificates, AI-review screens, control-room surfaces, evaluation harnesses, or "trust" ledgers until escalation ships AND real-file (non-synthetic) ingestion is credible. Matching Engine v2 (Slices 1–5) and Ledger Backbone v1 (6a + 6b) shipped on synthetic data — the synthetic-data foundations are done, but real-file ingestion + escalation are still the unfilled wedge gaps per `gaps.md` §P1 / §P5. Existing surfaces (`/quality`, `/webhook-operations`, `/close-control`, `/root-causes`, `/demo-control-room`, `/insights`) stay — they're demoted in nav but functional. Source: `gaps.md` §"What I would stop building."

If a request implies a new surface in that category, push back: name the foundation gap it's papering over, and propose extending an existing surface instead — or defer.

### AI is a helper, not a headline
Do not lead copy, page titles, route names, hero text, README intros, or feature framing with "AI" or "Copilot." The deterministic engine is the product; AI drafts investigation notes, classifies exception reasons, and helps map unknown report schemas with human approval. Per `gaps.md`: "Buyers do not wake up wanting a copilot. They wake up wanting fewer unreconciled settlement rows." The "PayOps Copilot" naming is being downgraded in user-visible surfaces for exactly this reason.

When you add an AI feature, attach it to one of: minutes saved per exception, first-action time, false positives reduced, recoveries identified, SLA breaches avoided, close-duration reduced. If you cannot, it's a demo feature — say so.

### Open commercial questions (do not claim as proven)
The following are unvalidated. Future Claude must not write copy, docs, or marketing that implies they are answered:
- **Buyer:** who signs the cheque? (Finance controller? Payment-ops manager? Head of finance at a mid-market merchant using 2–5 PGs?)
- **Replaced system:** what does PayOps replace? (Excel + PG dashboards? Cointab? In-house tooling?)
- **ROI:** what measurable number changes? (Close-day duration? Unreconciled exposure? Recovered under-settled rupees?)
- **Moat:** what compounds with each new customer? (Mapping library across Razorpay / Cashfree / PayU / Paytm / banks? Bank-narration normalization? Exception-resolution corpus?)
- **Distribution:** how does the first paying customer find PayOps?

These belong in product strategy work, not code. Don't paper over them with feature framing.

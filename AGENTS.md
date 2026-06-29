# PayOps Copilot Repository Guide

This file gives coding agents durable context for work in this repository.
Treat it as an operating contract, not as product documentation.

## Product intent

PayOps is **exclusively** focused on Indian mid-market merchant finance and
payment-operations teams — not aggregator escrow/nodal reconciliation, not
marketplace split-settlement, not support ops, not BNPL ops, not generic
"Indian payment ops." Those are out of scope until the merchant-finance wedge
proves itself with real customer files. It helps merchant finance teams prove
whether payment providers settled the right amount, explain deductions, map
UTRs to bank credits, and close payment books with evidence. It turns
exceptions into organization-scoped cases with ownership, SLAs, evidence,
AI-assisted investigations, human review, and audit history.

The product is a portfolio MVP. All demo data is synthetic. It must never imply
that it connects to live payment providers or can move money.

## Current product state

The project has evolved from a basic reconciliation workspace into an
operations-control portfolio product. Current shipped capabilities include:

- deterministic three-file reconciliation for internal orders, gateway reports,
  and bank settlements;
- organization-scoped exception cases with owners, priorities, SLA state,
  comments, audit history, and role-based access;
- evidence and integrity controls, including persisted source evidence,
  hash-only delivery records, signed synthetic provider events, idempotent
  webhook ingestion, and operational timelines;
- bounded AI investigation support with human review, reviewer disagreement
  tracking, and explicit guardrails that prevent AI from becoming financial
  truth;
- settlement-control policies for provider/payment-mode cycles, Indian demo
  business-calendar rules, expected settlement dates, overdue classification,
  and evidence explaining the rule that produced each deadline;
- manager-focused `/insights` metrics built from deterministic persisted
  records, with URL-backed filters and drill-through into Operations;
- recurring-exception remediation programs under `/root-causes`, including
  deterministic fingerprints, explicit promotion, linked cases, lifecycle
  events, owner controls, monitoring, and two-clean-run verification;
- merchant settlement statements under `/settlements`, including synthetic
  merchant accounts, settlement batches, line items, deductions, UTR
  classification, bank-credit evidence, linked Operations cases, and settlement
  rollups in Insights and Close Control;
- close-control, webhook-operations, quality/evaluation, runs, operations,
  refunds/disputes, and guided `/demo-control-room` surfaces;
- synthetic seeded history for demos, portfolio screenshots, and reviewer
  walkthroughs;
- a protected GitHub `main` branch, PR-based workflow, required `verify` and
  GitGuardian checks, and production Vercel deployment at
  `https://payops-copilot.vercel.app`.

The homepage now includes a reviewer-oriented start path. New reviewers should
begin at `/demo-control-room`, then inspect `/operations`, `/insights`, and
`/root-causes`, and only then use the CSV reconciliation workspace.

## Product direction

The product direction is to deepen PayOps into a **multi-PG settlement-exception
desk for Indian merchants** — the single workflow that proves UTR / fee / GST /
refund / chargeback / hold / bank-credit mismatches across 2–5 PGs before month
close, and produces controller-ready evidence packets. This is the wedge from
the `gaps.md` review. The selected ICP is merchant finance / payment operations
**only**. Aggregator escrow/nodal reconciliation and marketplace split settlement
are **not in scope** until merchant-finance proves a wedge with real customer
files. Do not add aggregator-flavored or marketplace-flavored UI, copy, or
schema. If a request implies broadening, surface the ICP boundary first.

The important product distinction is:

- **Settlement** moves or represents money owed to merchants, net of fees,
  taxes, refunds, chargebacks, recoveries, holds, and adjustments.
- **Reconciliation** proves every rupee by matching records across systems that
  update at different times.

The implemented merchant settlement statement layer helps a merchant or
payment-ops manager answer:

```text
Order → Transaction → Gross amount
→ MDR / GST / refund / chargeback / recovery / hold
→ Net settlement
→ Settlement batch
→ UTR
→ Bank credit
→ Evidence / Exception
```

Implemented release: **Statement Import + Settlement Exception Desk**.

This module sits above Merchant Settlement Statements:

1. Import provider-style merchant settlement statement CSVs into a staging
   workspace without overwriting the existing settlement ledger.
2. Normalize provider-specific rows into deterministic statement records and
   compare them to existing merchant settlement batches, deductions, UTRs, and
   bank credits.
3. Create settlement-specific exceptions for missing UTR, UTR not found in bank
   statement, duplicate UTR, amount mismatch, failed payout, held settlement,
   delayed credit, retry exhausted, deduction mismatch, unexplained hold, and
   forward refund/chargeback mismatch.
4. Add an Adjustment Desk for explicit admin/analyst proposals with reason,
   evidence, maker/checker approval, audit history, and no money movement.
5. Export reviewer-safe settlement evidence packets that show gross collected,
   deductions, net payable, UTR, bank credit, linked cases, and adjustment
   decisions.

Implemented release: **Source Ingestion Control Plane v1.1**.

Build this before more governance layers. The next credibility jump is proving
that PayOps can receive, profile, version, quarantine, and readiness-check the
messy daily files that real merchant finance teams depend on:

1. Expected-file registry for gateway transaction reports, provider settlement
   statements, bank statements, refund reports, chargeback/dispute reports, and
   fee/tax schedules.
2. Arrival SLA and source health states: expected, received, late, missing,
   duplicate, revised, partial, malformed, quarantined, and accepted.
3. Source versioning with hash, row count, amount totals, detected adapter,
   schema profile, parse diagnostics, superseded file link, and audit event.
4. Quarantine workflow so malformed or partial files do not enter
   reconciliation until an admin/analyst accepts or rejects the mapping.
5. Daily readiness board that answers: "Can we run recon and close books today?
   Which source is blocking us?"

Source Ingestion now includes version dossiers, audited quarantine decisions,
an immutable accepted-source contract, superseded-file lineage, persisted daily
readiness snapshots, and tenant/RBAC integration coverage.

**Matching Engine v2** is fully shipped (Slices 1–5): layered matching
strategies + confidence (Slice 1), reason-code taxonomy + cross-table refresh
hooks (Slices 2a/2b), an analyst-facing manual match / unmatch override layer
with admin maker-checker on unmatches (Slice 3), many-to-one payout sum
checks (Slice 4), and refund netting (Slice 5). The engine stays per-item
and stateless; every layer is an immutable side artifact composed at read
time. Slice 5 adds `transactionType` to `ProviderFieldMapping`, splits
capture rows from refund rows in the settlement CSV, persists refunds in
`reconciliation_refund_allocations` linked to their parent captures
(cross-run linkage supported), and stamps the 12th reason code
`refund_offset_recognized` when effective variance (engine settled + sum of
allocated refunds − expected net) lands within ₹0.01. Precedence chain:
per-item codes < `refund_offset_recognized` < `payout_sum_mismatch`;
manual overrides are orthogonal. Remaining: partial captures (multi-capture
lifecycle), fuzzy amount/date windows.

**Ledger Backbone v1** also shipped (Slices 6a `1f789b5` + 6b `3ad0122`,
merged 2026-06-29). Append-only double-entry journal with a 6-account chart
per merchant (merchant payable, provider receivable, escrow cash, fee
expense, GST liability, refund payable). Three bridges — in
reconciliation, merchant-settlements, and refund-allocations services —
post entries atomically inside the existing transaction boundary; nothing
in the engine layer changes. Per-PG receivable card on the settlement
detail drawer answers "did this batch tie out?" via
`getProviderReceivableBreakdown`. A canary test asserts ledger
`merchant_payable` ties to `calculateSettlementArithmetic.netAmount` for
every seeded batch (drift > ₹0.01 = ship-blocker). v1.1 will add explicit
`chargeback_receivable` / `hold` / `adjustment_writeoff` accounts and
auto-reverse on source mutation.

The explainable balance the ledger produces:

```text
opening receivable (per PG)
+ captures
- fees
- GST
- refunds netted
- bank credits
= closing receivable (per PG, per batch)
```

Only after escalation and real-file ingestion are credible should the
roadmap return to additional governance surfaces or split settlement. Split
settlement should eventually support platform/vendor shares, fee/tax
splits, refund splits, and vendor settlement files, but it is not the next
foundation. **Next: Evidence Escalation Outbox** — provider tickets with
attached evidence, parsed inbound replies, SLA-breach escalation.

## Stop building (until next foundation lands)

Per the `gaps.md` review: PayOps now has Matching Engine v2 + Ledger
Backbone v1 on synthetic data. The remaining wedge gaps are real-file
ingestion + escalation, not more governance scaffolding. Adding more
dashboards before those land is overbuild, not progress.

**Do not add:**

- new dashboards, certificates, AI-review screens, control-room surfaces;
- new evaluation harnesses, two-reviewer flows, or "trust" ledgers;
- new portfolio-walkthrough surfaces or demo-mode pages;
- AI features that are not measured against analyst minutes saved, recoveries
  identified, false positives reduced, or close-duration reduced.

**Do build:**

- real ingestion connectors (email/SFTP/API) for actual provider exports;
- the append-only ledger backbone (merchant payable, provider receivable,
  bank cash, fee receivable, GST liability, refund/chargeback recovery,
  hold/release, adjustment/write-off);
- layered matching with confidence scoring (order ID → gateway ref → UTR →
  bank narration → amount/date windows; many-to-one, partial, duplicate,
  reversal-aware);
- expanded exception taxonomy with financial exposure, owner, SLA, allowed
  actions, evidence requirement, auto-close condition, escalation path;
- the escalation loop (provider ticket, attached evidence, parsed reply,
  promised ETA, SLA-breach escalation).

Existing demo-flex surfaces (`/quality`, `/webhook-operations`,
`/close-control`, `/root-causes`, `/demo-control-room`, `/insights`) stay —
they're demoted in nav but functional. Don't delete; don't extend.

## Brand and positioning

- Product name in user-visible surfaces is **PayOps**, not "PayOps Copilot."
  The "Copilot" framing is downgraded because the AI is not load-bearing.
- The wedge tagline is "Multi-PG settlement-exception desk for Indian
  merchant finance teams." Use this (or close variations) in hero, metadata,
  and product brief copy. Do not lead with "AI," "Copilot," or "Indian
  payment teams."
- The historical name "PayOps Copilot" remains in repo/package name, Vercel
  URL, BUILD-STORY.md, docs/portfolio/* titles, and README header. Do not
  scrub it from history; only update forward-facing surfaces.
- Open commercial questions (buyer with budget, system replaced, measurable
  ROI, moat, distribution motion) are **unvalidated**. Do not write copy,
  docs, or framing that implies they are proven. The portfolio MVP boundary
  must stay honest.

## Non-negotiable boundaries

- Financial truth must come from deterministic TypeScript code and persisted
  source evidence, never from a language model.
- AI may explain a case, identify hypotheses, recommend verification steps, and
  draft a provider query.
- AI must not issue refunds, alter financial records, resolve cases, contact a
  provider, or claim knowledge of provider-side events.
- Human approval remains required for AI investigations.
- Every protected database query must be scoped by `organizationId`.
- Mutations require `admin` or `analyst`; audit reads require `admin`.
- Never commit credentials, real payment data, card data, bank data, or personal
  customer information.
- Demo provider names, webhook behavior, calendar rules, and settlement policies
  are synthetic. Do not imply PayOps is integrated with Paytm, Razorpay,
  Cashfree, PayU, banks, card networks, or any live payment rail.
- Do not claim settlement delivery success rates, provider-side outcomes, or
  bank-side events unless they are directly measured in persisted synthetic
  records.
- If credentials or database URLs are pasted into chat, screenshots, logs, or
  commits, treat them as compromised and rotate them before presenting the repo
  as production-quality.

## Architecture map

- `app/`: Next.js pages and API route handlers.
- `components/`: client-facing product workflows.
- `lib/reconciliation.ts`: deterministic normalization, matching, and arithmetic.
- `lib/ai-investigator.ts`: bounded OpenAI and deterministic fallback paths.
- `lib/modules/`: domain-owned backend repositories for reconciliation, cases,
  investigations, evaluations, payment workflows, provider events, insights,
  settlement control, remediation programs, close control, audit, and system
  health. Services own validation and orchestration; repositories own SQL.
- `lib/db.ts`: shared PostgreSQL pool, query helper, and transaction boundary.
- `lib/access.ts`: authentication and role checks.
- `lib/sla.ts`: SLA policy and status calculation.
- `db/migrations/`: ordered SQL migrations; never rewrite an applied migration.
- `scripts/`: database migration and seed utilities.
- `docs/portfolio/`: product, architecture, AI, demo, and portfolio evidence.

## Working method

1. Read the relevant code, tests, migrations, and documentation before editing.
2. State the user outcome and completion conditions in plain language.
3. Make the smallest complete change across database, API, UI, tests, and docs.
4. Use existing repository patterns unless there is a concrete reason to change.
   API routes must import the domain module they serve; do not recreate a
   catch-all repository or place business orchestration in route handlers.
   Add a service when a domain needs validation, state-transition policy,
   cross-repository coordination, or audit orchestration.
5. Exercise the real browser journey for user-facing changes.
6. Review the diff for security, tenancy, AI safety, and unsupported claims.
7. Run the required checks before committing.
8. Update every affected README, product document, architecture claim, demo
   instruction, measured count, and roadmap item in the same change.
9. For portfolio-facing UX, optimize for a 90-second reviewer path before
   optimizing for expert workflows. The app should always make the next click
   obvious to a recruiter, fintech PM, or engineering reviewer.

## Required checks

```bash
npm run lint
npm test
npm run build
git diff --check
```

For database changes:

- add a new numbered migration;
- test migration against the local PostgreSQL container;
- preserve existing data and constraints;
- update `.env.example` only with safe placeholders.

For AI changes:

- preserve structured Zod output;
- keep `store: false` unless the privacy decision is explicitly revisited;
- include model and prompt/version metadata when the schema supports it;
- test deterministic fallback behavior;
- evaluate evidence grounding and prohibited actions;
- do not weaken the human-review step.

## Definition of done

A change is complete when the intended user journey works, authorization and
organization scoping are preserved, important behavior is tested, documentation
matches reality, and the repository passes all required checks.

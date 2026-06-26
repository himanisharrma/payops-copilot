# Roadmap and Trade-offs

> Product judgment is visible in what was not built as much as in what was.

## Decisions made

### ADR-1: Deterministic reconciliation over AI reconciliation

**Chose:** typed normalization, matching, fee/tax arithmetic, and rule-based
status classification.

**Over:** asking a language model to compare rows or calculate settlement
amounts.

**Why:** financial outputs must be reproducible, testable, and explainable.

**Cost accepted:** provider-specific rules require explicit engineering rather
than prompt changes.

### ADR-2: AI after evidence, not before it

**Chose:** generate an investigation only after a persisted case contains a
status, identifiers, amounts, and evidence.

**Over:** a general chat interface over uploaded spreadsheets.

**Why:** a narrow context reduces unsupported claims and creates a reviewable
contract.

**Cost accepted:** the assistant cannot answer broad operational questions yet.

### ADR-3: Structured output over free text

**Chose:** Zod-validated fields for cause, confidence, evidence, actions,
message, and limitations.

**Over:** storing arbitrary model prose.

**Why:** the UI, audit model, feedback system, and versioned evaluation set need
a stable shape.

**Cost accepted:** schema changes require coordinated code changes.

### ADR-4: Human approval over autonomous action

**Chose:** explicit pending, approved, and rejected investigation states.

**Over:** allowing the model to resolve a case, send a message, or trigger a
refund.

**Why:** uploaded reports cannot prove provider-side events, and operational
accountability must remain with a person.

**Cost accepted:** slower automation and continued analyst effort.

### ADR-5: PostgreSQL over browser-only state

**Chose:** durable runs, cases, investigations, users, and events.

**Over:** a purely client-side portfolio demo.

**Why:** ownership, history, organization boundaries, and auditability require
persistence and constraints.

**Cost accepted:** local Docker setup and migration management.

### ADR-6: Organization scoping in the repository layer

**Chose:** pass `organizationId` into every protected repository operation.

**Over:** filtering only in the UI or relying only on route checks.

**Why:** tenancy is a data-access invariant, not a visual feature.

**Cost accepted:** more explicit function signatures and SQL predicates.

### ADR-7: Fixed SLA policy for the MVP

**Chose:** high 4 hours, medium 24 hours, low 72 hours.

**Over:** configurable calendars, holidays, queues, and customer contracts.

**Why:** a simple policy makes urgency measurable and demonstrates the workflow
without building a policy engine first.

**Cost accepted:** deadlines currently count elapsed hours, including weekends
and holidays.

### ADR-8: Synthetic CSV data over live integrations

**Chose:** three public fictional reports.

**Over:** sandbox credentials or real provider exports.

**Why:** the repository must be safe to clone, run, and review.

**Cost accepted:** integration reliability and provider-specific behavior are
not demonstrated.

### ADR-9: Credentials authentication for the portfolio

**Chose:** seeded fictional users with Auth.js and password hashing.

**Over:** implementing enterprise SSO for a local MVP.

**Why:** roles and organization boundaries needed to be experienced, while
production identity was outside the current proof.

**Cost accepted:** local credentials must be replaced before real use.

### ADR-10: One full-stack repository

**Chose:** Next.js pages and APIs, PostgreSQL migrations, tests, and docs in one
repository.

**Over:** separate frontend, backend, and documentation repositories.

**Why:** one product slice can be inspected, tested, committed, and reviewed
end to end.

**Cost accepted:** boundaries would need revisiting at team or scale growth.

### ADR-11: Modular monolith backend

**Chose:** domain-owned repositories under `lib/modules/` with shared database
infrastructure.

**Over:** one central repository file or premature microservices.

**Why:** reconciliation, cases, investigations, evaluations, payment
workflows, audit, and health change at different rates. Explicit modules reduce
coupling while preserving one deployment and transaction model.

**Cost accepted:** cross-domain workflows need deliberate public interfaces.
Service layers are introduced when orchestration or validation is meaningful,
rather than added mechanically to every module.

### ADR-12: Domain services for business orchestration

**Chose:** thin route handlers that delegate validation, lifecycle policy,
repository coordination, and audit writes to domain services.

**Over:** duplicating business rules in HTTP handlers or forcing service files
onto read-only modules with no orchestration.

**Why:** payment workflows, cases, and evaluations have meaningful mutation
rules that should be testable without HTTP or PostgreSQL.

**Cost accepted:** the modular monolith now has an additional layer and needs
clear service-to-repository contracts.

### ADR-13: Synthetic provider adapters before live integrations

**Chose:** typed provider mapping policies for generic, Razorpay-style,
Cashfree-style, and PayU-style demo files.

**Over:** connecting real provider APIs or accepting arbitrary spreadsheet
columns without a visible mapping report.

**Why:** provider differences are central to payment operations, but the public
portfolio must stay credential-free and safe to clone.

**Cost accepted:** the adapters demonstrate extensibility and data-quality
controls, not production export compatibility.

### ADR-14: Synthetic fixtures before signed inbound delivery

**Chose:** local provider webhook fixtures normalized into case and workflow
timelines.

**Over:** exposing a live webhook endpoint or storing provider secrets.

**Why:** event timelines are important to payment operations, but a public
portfolio should not simulate live provider connectivity or signature trust.

**Cost accepted:** the first slice proved the internal event model and UX before
delivery reliability and trust controls were added.

### ADR-15: A signed synthetic boundary before production connectivity

**Chose:** one environment-managed demo signing key, exact-body HMAC
verification, tenant/provider/event idempotency, normalized-event persistence,
and hash-only delivery evidence.

**Over:** storing raw payloads, provider credentials, or claiming compatibility
with a production provider signature scheme.

**Why:** the portfolio can now demonstrate the security and replay boundaries
of inbound events without pretending to operate a live payment integration.

**Cost accepted:** real deployment still needs provider-certified
verification, managed secret rotation, production telemetry, retention policy,
and incident response.

### ADR-16: Synthetic key rotation evidence before managed secrets

**Chose:** fictional provider-specific canonical strings, active and previous
environment-managed keys, hash-only attempt records, and an administrator trust
ledger.

**Over:** copying production provider signature schemes or presenting local
attempt outcomes as a reliability SLA.

**Why:** rotation behavior, replay boundaries, and rejection evidence can be
demonstrated safely without credentials or live connectivity.

**Cost accepted:** production deployment still needs a managed secrets system,
provider-certified contracts, retention policy, alerting, and incident
response.

### ADR-17: A signed operational close over another analytics dashboard

**Chose:** deterministic daily readiness, explicit materiality, residual-risk
dispositions, immutable versions, and analyst/administrator maker-checker.

**Over:** a mutable “closed” flag or a report that merely summarizes match
rate.

**Why:** payment operations need a defensible finish line: what was reviewed,
which risks remained, who prepared it, and who independently approved it.

**Cost accepted:** this portfolio policy is intentionally simple and still
needs configurable legal entities, accounting periods, and production control
ownership before real deployment.

## Roadmap

### Completed foundation: automate release confidence

- GitHub Actions now runs migration verification, lint, 68 unit/policy tests,
  fourteen PostgreSQL-backed integration tests, production build, and diff checks.
- Organization isolation tests cover scoped reads, blocked cross-tenant writes,
  database tenant constraints, and mutation/audit rollback.
- Authorization tests cover administrator, analyst, viewer, and unauthenticated
  behavior for reads, mutations, and audit access.

The evidence-integrity release now persists hashed source-row snapshots,
enforces tenant relationships across reconciliation records, and requires an
attributed evidence-backed case resolution.

### Completed foundation: extract the frontend system

- Shared operations-console primitives now own queue search, source-evidence
  ledgers, and provider-event timelines.
- Case queue and controlled-resolution UI are workflow-owned components.
- The reconciliation evidence drawer is isolated from upload and matching state.
- The visual direction, responsive rules, and evidence-rail differentiator are
  documented in `DESIGN-SYSTEM.md`.

### Completed foundation: governed model-quality review

- Two distinct reviewers can claim run-level assignments and save independent
  six-dimension scores without overwriting each other.
- Case results classify review state as unreviewed, single review, agreed,
  disputed, or adjudicated.
- Administrators can record a final adjudication after two reviews.
- Run details calculate assigned reviewers, reviewed cases, disagreement counts,
  adjudication counts, and aggregate human score.

### Completed foundation: signed events and operational signals

- The synthetic provider endpoint verifies an HMAC over organization, external
  event ID, and exact body before parsing.
- Deliveries are idempotent and persist only a body hash plus normalized event.
- Tenant-owned cases and payment workflows receive matching persisted evidence.
- The header inbox surfaces provider events and deterministic SLA risk.
- All roles can inspect signals; only administrators and analysts can mark them
  read, with an audit event.

### Completed foundation: operations intelligence

- Manager-focused 7/30/90-day metrics compare throughput, match rate,
  actionable exceptions, and median resolution with the preceding period.
- Current queue health, SLA breach outcome, exception mix, aging, provider
  performance, AI governance, and inbound evidence are deterministic SQL
  aggregates.
- URL-backed filters and chart drill-downs connect management signals to
  underlying cases instead of creating a detached reporting surface.
- The fictional demo-history seed is idempotent and deletes only records
  carrying its explicit marker.

### Next: complete measured model evidence

- Configure a controlled API key and execute the implemented 30-case OpenAI run.
- Complete representative two-reviewer scoring rather than relying on the
  workflow-verification cases.
- Expand adversarial tests before changing the default model or instructions.
- Turn approved analyst corrections into anonymized synthetic regression cases.

The evaluation design and initial release thresholds are documented in
[AI Model Evaluation](AI-MODEL-EVALUATION.md). Deterministic and guarded model
execution are implemented; actual model evidence and representative
representative scoring remain the next evidence-collection slice.

### Completed operations depth: case collaboration

- Admins and analysts can mark up to 100 cases and assign or unassign the
  selection in one transaction.
- A missing or cross-organization case rejects the complete batch rather than
  leaving a partial assignment.
- Internal comments are attributed, append-only, organization-scoped, and
  readable by viewers without exposing mutation controls.
- Bulk assignment and comment creation write audit evidence in the same
  transaction as the operational mutation.

### Completed operations depth: settlement control

- Provider and payment-mode cycle policies calculate expected settlement using
  IST cutoffs, weekends, and versioned fictional closure dates.
- Reconciliation keeps financial status separate from settlement timing, so a
  missing settlement can remain monitored without becoming a premature case.
- An organization-scoped refresh promotes newly overdue records exactly once
  and writes an audit summary in the same transaction.
- Provider performance separates on-time, late, overdue, and timing-ineligible
  records without inventing dates for historical data.

**Boundary:** the policies demonstrate product and engineering controls; they
are not live provider contracts or an RBI settlement calendar.

### Completed operations depth: webhook trust operations

- Three fictional provider contracts use distinct canonical strings with
  explicit version and key headers.
- Active and previous keys support a bounded rotation window without storing
  secrets or signatures.
- Known-tenant attempts persist hash-only accepted, duplicate, rejected,
  conflict, and failed evidence with precise failure codes.
- The administrator trust ledger compares provider outcomes, previous-key
  usage, and processing time while avoiding production reliability claims.

**Boundary:** these contracts are synthetic and intentionally do not claim
compatibility with Razorpay, Cashfree, or PayU production signatures.

### Completed financial control: reconciliation close

- A daily control book scopes readiness by organization, IST business date,
  provider, and payment mode.
- High-priority exceptions block close; lower-priority residuals require
  materiality headroom and an evidence-confirmed disposition.
- Submission freezes an immutable, hashed version instead of mutating the live
  queue underneath an approval.
- A different administrator approves the analyst-prepared version.
- Controlled reopening preserves the approved certificate and creates room for
  a later version.

**Boundary:** the downloadable certificate is internal synthetic evidence, not
a bank statement, provider attestation, accounting opinion, or regulatory
sign-off.

### Completed operations depth: recurring-exception programs

- A deterministic four-field fingerprint identifies repeated actionable work
  without reading notes, comments, AI output, or free text.
- Three cases in the trailing 30 days create a ranked suggestion; an admin or
  analyst must explicitly promote it.
- Programs retain eligible ownership, targets, implementation evidence,
  linked cases, and append-only lifecycle history.
- Only an administrator may verify two subsequent clean runs or abandon a
  program with an attributed reason.

**Boundary:** verified means observed absence in two qualifying runs, not a
permanent provider-side correction.

### Shipped: merchant settlement statements

- The normal merchant settlement statement layer comes before split
  settlement.
- The ledger foundation tracks synthetic merchant accounts, settlement batches,
  line items, deductions, bank credits, UTR classifications, linked cases, and
  events.
- The idempotent `merchant-settlements-v1` seed covers credited-with-UTR,
  pending/scheduled, held, failed, partially credited, delayed credit, missing
  UTR, duplicate UTR, amount mismatch, forward refund, forward chargeback, and
  hold/release scenarios.
- Forward refunds and chargebacks are modeled as deductions against later
  payable batches rather than provider-side clawbacks.

**Boundary:** these records are synthetic statement evidence. They do not
prove live provider outcomes, bank-side events, payout success, or money
movement.

### Shipped: Statement Import + Settlement Exception Desk

- Import provider-style merchant settlement statement CSVs into a staging
  workspace without overwriting the existing settlement ledger.
- Normalize imported rows and compare them against settlement batches,
  deductions, UTRs, and bank credits.
- Create settlement-specific exceptions for missing UTR, duplicate UTR,
  amount mismatch, failed payout, held settlement, delayed credit, deduction
  mismatch, unexplained hold, and forward refund/chargeback mismatch.
- Add an Adjustment Desk for admin/analyst proposals with reason, evidence,
  maker/checker approval, audit history, and no money movement.
- Export reviewer-safe settlement evidence packets.

**Boundary:** imported statement rows remain synthetic in the portfolio demo.
This does not add live provider, bank, payout, or money-moving behavior.

### In progress: Source Ingestion Control Plane

The biggest remaining product gap is upstream of matching. Real merchant
finance teams do not receive perfectly shaped files; provider, bank, refund,
chargeback, and fee/tax files arrive late, duplicated, partial, malformed, or
revised.

This release adds the first control-plane slice:

- expected-file registry by provider, source type, merchant, and business day;
- arrival SLA states: expected, received, late, missing, duplicate, revised,
  partial, malformed, quarantined, and accepted;
- source versioning with hash, row count, control totals, detected adapter,
  schema profile, parse diagnostics, superseded-file link, and audit event;
- quarantine review so bad files do not enter reconciliation until accepted;
- daily readiness board answering whether recon and close can run today.
- synthetic manual CSV intake only; no live provider, bank, email, SFTP, or API
  pull is claimed.

### Next: Matching Engine v2

- Layer exact and ambiguous matching across order ID, gateway transaction ID,
  bank reference, UPI RRN/ARN, UTR, amount/date windows, payout IDs, partial
  captures/refunds, reversals, duplicates, and many-to-one bank credits.
- Store confidence reasons and candidate alternatives instead of only final
  matched/unmatched status.
- Add review queues for ambiguous, duplicate, partial, and reversal-aware
  matches.

### Then: Ledger Backbone v1

- Add immutable ledger entries for merchant payable, provider/acquirer
  receivable, bank cash, fee receivable, GST liability, refund recovery,
  chargeback recovery, holds/releases, and adjustment/write-offs.
- Produce an auditable balance equation:

```text
opening balance
+ collections
- fees
- GST
- refunds
- chargebacks
- holds
+ releases
- payouts
= closing payable / exposure
```

### After that: deepen payment operations

- Add a controlled escalation outbox for approved evidence packs.
- Add configurable business calendars and outbound escalation notifications.
- Add split settlement only after ingestion, matching, ledger truth, statement
  import, exception handling, and adjustment governance are stable.

### Then: production controls

- Enterprise identity, user provisioning, and access reviews.
- Managed database backups, encryption, and secrets rotation.
- Idempotent uploads and asynchronous jobs for large reports.
- Observability for run failures, queue depth, SLA breach rate, and AI usage.
- Tamper-evident audit retention and data-retention policy.
- Threat modeling, penetration testing, and formal privacy review.

### Expansion options

- Multi-merchant/provider workspaces.
- Split settlement after the normal statement layer is solid: platform/vendor
  shares, fee/tax splits, refund splits, and vendor settlement files.
- Payout and reserve reconciliation.
- Dispute evidence preparation.
- Natural-language portfolio analytics over verified database queries.
- Provider support tools with explicit human confirmation before sending.

## What would change the roadmap

The roadmap should respond to evidence:

- high repeated exception rates would prioritize provider-specific adapters;
- high SLA breaches would prioritize staffing and notification controls;
- low AI approval rates would pause model expansion and focus on evaluation;
- upload size or latency problems would trigger asynchronous processing;
- security or tenancy findings would outrank all feature work.

---

[Back to README](../../README.md) |
[Product Case Study](PRODUCT-CASE-STUDY.md) |
[Architecture](ARCHITECTURE.md)

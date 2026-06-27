# PayOps Copilot: Product Requirements

## Product statement

PayOps Copilot helps Indian mid-market merchant finance and payment-operations
teams prove whether payment providers settled the right amount, explain
deductions, map UTRs to bank credits, and close payment books with evidence.

## Primary user

A payment operations analyst or finance manager at an Indian merchant. Payment
aggregator escrow/nodal reconciliation and marketplace split settlement are
future expansion tracks, not the first ICP.

## Core problem

The analyst receives provider exports, settlement statements, bank statements,
refund reports, chargeback reports, and fee/tax schedules at different times
and in different shapes. Existing work is slow, repetitive, difficult to audit,
and brittle when files arrive late, malformed, duplicated, partial, or revised.

## Current product outcome

A user can upload synthetic files and inspect a transparent reconciliation and
settlement-control workspace with provider mapping diagnostics, matched
transactions, prioritized exceptions, row-level evidence, durable cases, SLA
controls, bounded AI assistance, separate refund and chargeback queues,
merchant settlement statements, statement imports, maker/checker adjustment
records, and synthetic evidence packets.

## User story

As a payment operations analyst, I can upload internal orders, gateway
transactions, and settlement reports so that I can understand why expected and
actual settlements differ.

As a merchant operations manager, I can inspect a synthetic settlement
statement that separates gross collections, deterministic deductions, net
payable, UTR evidence, bank-credit mapping, and linked line-level cases so that
the distinction between settlement and reconciliation is explicit.

## Acceptance criteria

- The app accepts three CSV files: orders, gateway, and settlements.
- A built-in synthetic dataset demonstrates the workflow without private data.
- The user can select a generic, Razorpay-style, Cashfree-style, or PayU-style
  synthetic provider adapter.
- Common and provider-specific column aliases are normalized automatically.
- The app reports row counts, mapped fields, unmapped fields, duplicate order
  references, invalid amounts, and unknown statuses before presenting results.
- Matching uses merchant order ID and gateway reference.
- Fee and GST deductions are included in expected net settlement.
- Exceptions include missing gateway rows, duplicate captures, missing
  settlements, and amount mismatches.
- Every finding shows evidence from the source records.
- New reconciliation runs persist the contributing source-row number, selected
  normalized values, original source values, and an integrity hash without
  retaining the complete uploaded file.
- Reconciliation runs and findings persist in PostgreSQL.
- Actionable exceptions automatically create operations cases.
- Analysts can assign an owner, change status and priority, and save notes.
- Priority automatically sets a case SLA: high in 4 hours, medium in 24
  hours, and low in 72 hours.
- Operators can filter at-risk and overdue cases and see an in-app SLA alert.
- A case cannot move to resolved until an analyst supplies a resolution reason
  and confirms review of its durable source evidence; the resolver is recorded.
- Analysts can generate a structured investigation grounded in case evidence.
- AI suggestions require explicit approval or rejection before operational use.
- Analyst usefulness ratings persist as input for governed evaluation-set
  expansion.
- Admins and analysts can run a versioned 30-case deterministic evaluation and
  explicitly request a guarded OpenAI evaluation.
- Reviewers can inspect case-level evaluation evidence and save six rubric
  scores with notes and attribution.
- Two distinct reviewers can claim run-level slots, review independently, see
  disagreement, and leave an administrator to record the adjudicated score.
- Refund and chargeback workflows track owner, deadline, evidence, stage, notes,
  timeline events, and audit history without moving money.
- Chargeback evidence cannot advance to submitted until the checklist is
  complete.
- Synthetic provider webhook payloads normalize into case and workflow
  timelines that state what each event proves and does not prove.
- A synthetic-only inbound boundary verifies an HMAC signature over the
  organization, external event ID, and exact body; duplicate deliveries are
  idempotent and raw payloads are not stored.
- Fictional provider-specific signature policies support active and previous
  keys, explicit key IDs, a bounded timestamp window where required, and
  precise rejection evidence without persisting request bodies or secrets.
- Administrators can inspect organization-scoped accepted, duplicate, rejected,
  conflict, failed, previous-key, and processing-time evidence by provider.
- Matched provider events and deterministic SLA risk appear as
  organization-scoped in-app notifications. Viewers may read them; only admins
  and analysts may update read state.
- Operations managers can inspect deterministic 7/30/90-day metrics for
  throughput, match rate, actionable exceptions, resolution time, SLA outcome,
  queue health, aging, provider performance, AI governance, and signed inbound
  evidence.
- Insights filters are shareable in the URL, and charts drill into the
  underlying filtered operations cases.
- Admins and analysts can select up to 100 visible cases and assign or unassign
  them atomically; partial cross-tenant batches are rejected.
- Every authenticated role can read attributed internal case comments. Admins
  and analysts can append comments; existing entries cannot be edited in place.
- Successful payments use deterministic fictional provider and payment-mode
  cycles to calculate expected settlement in `Asia/Kolkata`.
- Missing settlements remain monitored while not due or due today; they become
  actionable cases only after the persisted expected-settlement timestamp.
- Analysts can run an audited idempotent settlement refresh to promote newly
  overdue records without duplicating cases.
- Settlement timing evidence records the timestamp source, cycle, cutoffs,
  skipped synthetic closure dates, and policy/calendar versions.
- Every authenticated role can inspect daily reconciliation close readiness by
  IST business date, provider, and payment mode.
- High-priority unresolved cases always block close. Lower-priority residuals
  must stay within count and amount thresholds and receive an evidence-confirmed
  disposition before submission.
- Analysts and administrators may prepare a close; only a different
  administrator may approve it.
- Approved close versions retain an immutable deterministic snapshot and hash.
  Administrator reopening requires a reason and permits a new version without
  altering the prior certificate.
- Approved synthetic close certificates are downloadable by every
  organization-scoped role.
- Merchant settlement statement proof data covers credited-with-UTR,
  pending/scheduled, held, failed, partially credited, delayed credit, missing
  UTR, duplicate UTR, amount mismatch, forward refund, forward chargeback, and
  hold/release scenarios.
- Merchant settlement statement seed data is idempotent under marker
  `merchant-settlements-v1` and deletes/recreates only seed-owned settlement
  batches, source evidence, and linked cases.
- Settlement statement evidence is deterministic and persisted. It must never
  imply live provider connectivity, bank-side confirmation, or payout
  execution.
- No real payment is initiated and no payment-provider credentials are
  collected.

## Non-goals

- Moving money or initiating a provider-side refund.
- Connecting to production payment gateways.
- Using real provider credentials or claiming live provider compatibility.
- Claiming production webhook compatibility or accepting unsigned events.
- Treating synthetic webhook attempt outcomes as provider uptime or production
  delivery-success telemetry.
- Persisting raw webhook payloads or provider credentials.
- Storing original uploaded file contents permanently.
- AI-generated financial calculations.
- Autonomous provider communication or case resolution.
- Production identity, compliance certification, or operational telemetry.
- Real provider settlement contracts or an RBI holiday calendar.
- Treating a PayOps close certificate as a bank statement, provider
  attestation, or regulatory sign-off.
- Using notes, comments, AI output, or free text to detect recurrence.
- Treating two clean runs as proof of a permanent provider correction.
- Moving split-settlement logic ahead of the normal merchant statement layer.
- Treating statement seed data as production settlement delivery, provider
  settlement success, or bank confirmation.

## Product principles

1. Evidence before explanation.
2. Deterministic arithmetic for financial values.
3. Human approval for operational actions.
4. Never silently discard an uploaded row.
5. Synthetic data by default for the public portfolio.

## Recurring-exception programs

- Suggest a recurrence only when at least three actionable cases share
  provider, normalized payment mode, reconciliation status, and case origin in
  the trailing 30 days.
- Use persisted deterministic records for grouping, exposure, ranking,
  automatic linking, and clean-run verification.
- Allow admins and analysts to create and manage programs; viewers remain
  read-only; only admins may verify or abandon.
- Require implementation summary and evidence before monitoring, then two
  subsequent qualifying clean runs before administrator verification.

## Settlement import and exception desk

- Admins and analysts can upload synthetic provider-style merchant statement
  CSVs into staging; viewers can inspect read-only results.
- Imported rows never overwrite the merchant settlement ledger.
- Deterministic comparison links statement rows to settlement batches, lines,
  deductions, UTRs, bank credits, and line-level Operations cases where
  available.
- Settlement-specific exceptions cover missing UTR, UTR not found, duplicate
  UTR, amount mismatch, failed payout, held settlement, delayed credit, retry
  exhausted, deduction mismatch, unexplained hold, and forward deduction
  mismatch.
- Adjustment proposals are governance records only. Approval requires a
  different administrator and does not mutate payouts, bank credits, or money
  movement state.
- Evidence packet export is reviewer-safe JSON with synthetic-only boundary
  language and no secrets.

## Reality gap and next releases

The product is still a synthetic portfolio MVP. The next releases should reduce
the gap between a demo workspace and a credible merchant recon product:

1. **Implemented — Source Ingestion Control Plane v1.1:** `/source-ingestion`
   expected-file registry, arrival SLA, version detail and lineage, schema
   profiling, control totals, audited quarantine decisions, immutable
   accepted-source contracts, and persisted daily readiness snapshots. Intake
   is synthetic manual CSV only; live email, SFTP, API, bank, or provider pulls
   remain out of scope.
2. **Next — Matching Engine v2:** layered matching across order IDs, gateway
   transaction IDs, bank references, UPI RRN/ARN, UTRs, amount/date windows,
   many-to-one payouts, partial captures/refunds, duplicates, reversals, and
   confidence reasons.
3. **Ledger Backbone v1:** immutable merchant payable, provider/acquirer
   receivable, bank cash, fee receivable, GST liability, refund recovery,
   chargeback recovery, hold/release, and adjustment/write-off entries.
4. Controlled evidence-pack escalation, configurable calendars, production
   identity, managed secrets, observability, and incident response.
5. Split settlement only after ingestion, matching, and ledger truth are solid.

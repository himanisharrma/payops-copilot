# PayOps Copilot: Product Requirements

## Product statement

PayOps Copilot helps payment operations teams reconcile internal orders,
gateway transactions, and bank settlements without manually comparing
spreadsheets row by row.

## Primary user

A payment operations analyst at an Indian merchant or payment aggregator.

## Core problem

The analyst receives reports with different column names and needs to identify
missing settlements, duplicate payments, amount mismatches, and incomplete
gateway records. Existing work is slow, repetitive, and difficult to audit.

## Current product outcome

A user can upload three CSV files and receive a transparent reconciliation
report with provider mapping diagnostics, matched transactions, prioritized
exceptions, row-level evidence, durable cases, SLA controls, bounded AI
assistance, evaluation evidence, and separate refund and chargeback queues.

## User story

As a payment operations analyst, I can upload internal orders, gateway
transactions, and settlement reports so that I can understand why expected and
actual settlements differ.

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
- Matched provider events and deterministic SLA risk appear as
  organization-scoped in-app notifications. Viewers may read them; only admins
  and analysts may update read state.
- No real payment is initiated and no payment-provider credentials are
  collected.

## Non-goals

- Moving money or initiating a provider-side refund.
- Connecting to production payment gateways.
- Using real provider credentials or claiming live provider compatibility.
- Claiming production webhook compatibility or accepting unsigned events.
- Persisting raw webhook payloads or provider credentials.
- Storing original uploaded file contents permanently.
- AI-generated financial calculations.
- Autonomous provider communication or case resolution.
- Production identity, compliance certification, or operational telemetry.

## Product principles

1. Evidence before explanation.
2. Deterministic arithmetic for financial values.
3. Human approval for operational actions.
4. Never silently discard an uploaded row.
5. Synthetic data by default for the public portfolio.

## Next releases

1. Complete representative two-reviewer scoring and a funded OpenAI evaluation.
2. Turn approved analyst corrections into governed synthetic regression cases.
3. Add provider-specific signature policies, managed secret rotation,
   delivery observability, and settlement-cycle metadata.
4. Add configurable business calendars and outbound escalation notifications.
5. Add production identity, observability, and retention controls.

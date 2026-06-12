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

## MVP outcome

A user can upload three CSV files and receive a transparent reconciliation
report with matched transactions, prioritized exceptions, and row-level
evidence.

## User story

As a payment operations analyst, I can upload internal orders, gateway
transactions, and settlement reports so that I can understand why expected and
actual settlements differ.

## Acceptance criteria

- The app accepts three CSV files: orders, gateway, and settlements.
- A built-in synthetic dataset demonstrates the workflow without private data.
- Common column aliases are normalized automatically.
- Matching uses merchant order ID and gateway reference.
- Fee and GST deductions are included in expected net settlement.
- Exceptions include missing gateway rows, duplicate captures, missing
  settlements, and amount mismatches.
- Every finding shows evidence from the source records.
- Reconciliation runs and findings persist in PostgreSQL.
- Actionable exceptions automatically create operations cases.
- Analysts can assign an owner, change status and priority, and save notes.
- Analysts can generate a structured investigation grounded in case evidence.
- AI suggestions require explicit approval or rejection before operational use.
- Analyst usefulness ratings persist for future evaluation datasets.
- No real payment is initiated and no credentials are collected.

## Non-goals for the first release

- Moving money or initiating refunds.
- Connecting to production payment gateways.
- Storing original uploaded file contents permanently.
- AI-generated financial calculations.

## Product principles

1. Evidence before explanation.
2. Deterministic arithmetic for financial values.
3. Human approval for operational actions.
4. Never silently discard an uploaded row.
5. Synthetic data by default for the public portfolio.

## Next releases

1. Add authentication and workspace permissions.
2. Build a golden evaluation set from investigation feedback.
3. Add SLA tracking and notifications to the operations inbox.
4. Add refund, chargeback, and webhook timelines.
5. Add provider-specific investigation tools and policies.

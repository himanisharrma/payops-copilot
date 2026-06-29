# Demo Guide

> A five-minute hiring-manager walkthrough using only fictional data.

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev -- --hostname 127.0.0.1 --port 4317
```

Open `http://127.0.0.1:4317`.

Use:

```text
admin@payops.local
PayOpsDemo123!
```

The demo works without an OpenAI key. In that mode, investigations are clearly
labeled `Evidence rules - demo mode`.

Set `SYNTHETIC_WEBHOOK_SECRET` to a fictional local value if demonstrating the
legacy signed event endpoint. To demonstrate rotation evidence, copy the safe
fictional `SYNTHETIC_WEBHOOK_KEYRING` shape from `.env.example`. Never reuse a
real provider secret.

## 90-second reviewer path

Open **Control Room Demo Mode** at
`http://127.0.0.1:4317/demo-control-room`.

Use it as the portfolio landing path when the reviewer has little time:

1. **Source readiness** - open `/source-ingestion`, inspect a version dossier,
   follow its lineage, and show why a quarantined file is blocked from recon.
2. **Reconciliation run** - show that three synthetic reports become one
   deterministic ledger.
3. **Merchant settlement statements + ledger receivable card** - show gross
   collected, deductions, net payable, UTR, bank-credit evidence, and linked
   line-level cases. Then open the settlement detail drawer and point to the
   "Receivable from Razorpay (UTR ...)" card with the algebraic breakdown
   (opening + captures − fees − GST − refunds − bank credit = closing) and
   the green ✓ tied-out pill for any matched batch. This is the wedge:
   per-PG receivable, answered visibly from the immutable double-entry
   ledger.
4. **Statement import desk** - show staged provider-style CSV rows, comparison
   exceptions, maker/checker adjustment records, and evidence packet export.
5. **Exception case** - show that actionable differences become owned work with
   source evidence and SLA context.
6. **Settlement deadline evidence** - show that expected dates come from a
   fictional settlement-cycle policy and India demo calendar.
7. **Signed webhook evidence** - as an administrator, show accepted and rejected
   synthetic provider attempts without raw payload retention.
8. **Insights dashboard** - show manager KPIs and drill-through into the
   operations queue.
9. **Root-cause program verification** - show deterministic recurrence grouping
   and two clean-run verification.
10. **Close Control** - show maker/checker close readiness, residual exposure,
   and settlement payable impact.

Recommended screenshots for portfolio review:

- `docs/portfolio/assets/root-cause-control-board.png`
- `docs/portfolio/assets/settlement-evidence-workflow.png`
- `docs/portfolio/assets/payops-architecture-proof.png`

## Five-minute script

### 0:00-0:40 - Frame the problem

Say:

> "A payment operation is described by three imperfect reports: what the
> merchant expected, what the gateway processed, and what the bank settled.
> PayOps makes the differences explicit, then turns them into accountable
> operational work."

On the reconciliation page, point out:

- synthetic-data safe mode;
- the three-source layout;
- deterministic-calculation label;
- the statement that PostgreSQL stores the result.

### 0:40-1:30 - Run reconciliation

1. Select **Load demo data**.
2. Show the detected row counts.
3. Select **Run reconciliation**.
4. Point out match rate, processed value, value to investigate, and control
   status.
5. Open one exception and show its order, gateway, and settlement source-row
   snapshots and integrity hashes.

Explain that header normalization and financial calculations happen in code,
not in the AI assistant.

### 1:30-2:40 - Operate the exceptions

Open **Operations**.

Show:

- active, at-risk, overdue, and resolved counts;
- the attention-needed alert;
- status and SLA filters;
- owner, priority, notes, and evidence;
- the deadline and target in the SLA control.
- the controlled resolution flow, which requires a reason and evidence-review
  confirmation before recording the resolver and audit event.
- selection checkboxes and the dispatch rail for assigning multiple cases
  without opening each record.
- the attributed internal handoff log; add a concise comment, reload, and show
  that viewers can read it without receiving write controls.

Use one case to explain the transition from a report finding to an owned piece
of work.

Show a missing settlement that is still inside its fictional T+1 or T+2 cycle.
Point out that PayOps persists the expected date and policy evidence but does
not create a case yet. Then use **Refresh settlement clocks** and open an
overdue settlement-origin case. Compare the settlement clock with the separate
4/24/72-hour case SLA.

### 2:40-3:40 - Explain the AI boundary

Open a case with an investigation or choose **Investigate with AI**.

Point out:

- confidence is visible;
- likely cause is a hypothesis;
- recommended actions ask for verification;
- the provider message is a draft;
- limitations are explicit;
- approve, reject, and usefulness controls are human actions.

Say:

> "The AI never receives a tool for money movement. It cannot calculate the
> settlement truth, contact the provider, or resolve the case. It helps an
> analyst prepare the next step."

### 3:40-4:05 - Show payment lifecycles

Open **Refunds & disputes**. Show that refunds and chargebacks have separate
states, deadlines, evidence checklists, owners, and timelines. Explain that the
application records operational decisions but has no provider integration that
moves money.

If available, open **Settlements**. Explain the product distinction:
settlement is the merchant payable trail from gross collection through
deductions, net payable, UTR, and bank credit evidence; reconciliation proves
whether records from different systems agree. Show a credited statement, a
missing-UTR or duplicate-UTR case link, and a forward refund/chargeback
deduction. Say clearly that all records are fictional and no payout is
executed.

Open **Statement Imports**. Upload or inspect the seeded synthetic provider
statement CSV. Show that rows enter a staging area, comparison does not
overwrite the settlement ledger, exceptions are settlement-specific, and
adjustments require maker/checker governance. Export the evidence packet and
call out that it contains reviewer-safe synthetic evidence only.

### 4:05-4:30 - Show quality and accountability

Open **Insights** first. Show the 30-day KPI ledger, current queue, daily
activity signal, exception mix, aging, and provider comparison. Change the
range to seven days, then open one exception bar to demonstrate that management
metrics drill into the actual filtered case queue.
In the provider comparison, explain that on-time settlement rates include only
records with both expected and actual timestamps; incomplete evidence is not
treated as zero performance.

Open **Daily close**. Start with an open scope and show how count and amount
materiality interact with the residual-risk register. Then open the seeded
submitted period: the analyst is the maker and a different administrator is
the checker. Approve it, download the JSON certificate, and explain that its
snapshot hash remains unchanged even if the period is later reopened.

Open **Root causes**. Show the ranked detection queue and explain that its
fingerprint uses only provider, payment mode, exception status, and case
origin. Promote a suggestion, then open a seeded monitoring program. Use the
linked-case drill-through and two-clean-run rail to distinguish implementing a
fix from administrator verification. Do not call verification permanent proof.

Open **Quality** and show the versioned 30-case baseline, persisted run history,
case-level evidence, and six-score human rubric. Do not claim OpenAI model
quality: no paid model run completed in this repository snapshot.

Open **Audit**.

Show that reconciliation and case activity records the actor, entity, action,
and timestamp. Explain that audit access is admin-only and records are scoped
to the organization.

Open the bell in the header and show the evidence inbox. Explain that SLA
signals are derived from the deterministic deadline policy and provider
signals come only from signed synthetic deliveries. Marking a signal read is
an audited admin/analyst action.

Open **Webhook trust** as the administrator. Show the provider rotation spine,
one accepted previous-key attempt, and rejected stale-signature evidence.
Explain that only hashes, key identifiers, outcomes, and processing metadata
are retained. The panel is evidence about local synthetic requests, not a
provider uptime dashboard.

### 4:30-5:00 - Demonstrate role boundaries

Sign out and use:

```text
viewer@payops.local
PayOpsDemo123!
```

Open **Operations**, select a case, and show that status, owner, priority,
notes, AI review, and feedback controls are disabled. The Audit navigation is
absent, and direct access redirects home.

Close with:

> "This project demonstrates product judgment across the full workflow:
> deterministic payment controls, human-governed AI, operational SLAs,
> organization and role boundaries, and an auditable implementation."

## Reviewer shortcuts

| Goal | Route |
| --- | --- |
| Reconcile | `http://127.0.0.1:4317/` |
| Operations and SLA | `http://127.0.0.1:4317/operations` |
| Refunds and disputes | `http://127.0.0.1:4317/refunds-disputes` |
| AI Quality Lab | `http://127.0.0.1:4317/quality` |
| Operations Intelligence | `http://127.0.0.1:4317/insights` |
| Historical runs | `http://127.0.0.1:4317/runs` |
| Administrator audit | `http://127.0.0.1:4317/audit` |
| Webhook Trust Operations | `http://127.0.0.1:4317/webhook-operations` |
| Daily Reconciliation Close | `http://127.0.0.1:4317/close-control` |
| Recurrence Control Board | `http://127.0.0.1:4317/root-causes` |
| Control Room Demo Mode | `http://127.0.0.1:4317/demo-control-room` |
| Product summary | `http://127.0.0.1:4317/product-brief` |
| Database health | `http://127.0.0.1:4317/api/health` |

## What not to claim

- Do not describe the demo as connected to a real gateway or bank.
- Do not describe AI output as a confirmed root cause.
- Do not describe the deterministic evaluation baseline as OpenAI model proof.
- Do not describe local credentials as production authentication.
- Do not describe the signed synthetic endpoint as a live provider connection
  or production signature implementation.
- Do not describe webhook attempt outcomes as provider uptime or a production
  delivery-success rate.
- Do not describe the close certificate as a bank statement, provider
  attestation, accounting sign-off, or regulatory evidence.
- Do not describe a verified remediation program as proof of a permanent
  provider fix.
- Do not claim measured analyst savings or AI accuracy.
- Do not upload private company reports to the public portfolio instance.

---

[Back to README](../../README.md) |
[Product Case Study](PRODUCT-CASE-STUDY.md)

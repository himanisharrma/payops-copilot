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
signed event endpoint. Never reuse a real provider secret.

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

### 4:05-4:30 - Show quality and accountability

Open **Insights** first. Show the 30-day KPI ledger, current queue, daily
activity signal, exception mix, aging, and provider comparison. Change the
range to seven days, then open one exception bar to demonstrate that management
metrics drill into the actual filtered case queue.

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
| Product summary | `http://127.0.0.1:4317/product-brief` |
| Database health | `http://127.0.0.1:4317/api/health` |

## What not to claim

- Do not describe the demo as connected to a real gateway or bank.
- Do not describe AI output as a confirmed root cause.
- Do not describe the deterministic evaluation baseline as OpenAI model proof.
- Do not describe local credentials as production authentication.
- Do not describe the signed synthetic endpoint as a live provider connection
  or production signature implementation.
- Do not claim measured analyst savings or AI accuracy.
- Do not upload private company reports to the public portfolio instance.

---

[Back to README](../../README.md) |
[Product Case Study](PRODUCT-CASE-STUDY.md)

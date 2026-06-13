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
5. Open one exception and read its evidence.

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

### 3:40-4:20 - Show accountability

Open **Audit**.

Show that reconciliation and case activity records the actor, entity, action,
and timestamp. Explain that audit access is admin-only and records are scoped
to the organization.

### 4:20-5:00 - Demonstrate role boundaries

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
| Historical runs | `http://127.0.0.1:4317/runs` |
| Administrator audit | `http://127.0.0.1:4317/audit` |
| Product summary | `http://127.0.0.1:4317/product-brief` |
| Database health | `http://127.0.0.1:4317/api/health` |

## What not to claim

- Do not describe the demo as connected to a real gateway or bank.
- Do not describe AI output as a confirmed root cause.
- Do not describe local credentials as production authentication.
- Do not claim measured analyst savings or AI accuracy.
- Do not upload private company reports to the public portfolio instance.

---

[Back to README](../../README.md) |
[Product Case Study](PRODUCT-CASE-STUDY.md)

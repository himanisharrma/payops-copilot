# AI Workflows and Agents

> Repeatable ways to use Codex on PayOps Copilot without giving an agent
> unbounded authority.

## Workflow 1: Build a vertical product slice

Use when adding a capability such as SLA tracking, provider timelines, or bulk
case assignment.

1. Define the user problem and observable acceptance criteria.
2. Inspect relevant UI, API, repository, migrations, tests, and docs.
3. Identify affected trust boundaries: financial logic, role access, tenancy,
   audit, and AI.
4. Implement the smallest end-to-end slice.
5. Run lint, tests, build, and the browser journey.
6. Review the diff and publish one intentional commit.

Example request:

```text
Add bulk assignment for open cases. Admins and analysts can select cases from
their own organization and assign one owner. Record one audit event containing
the affected case IDs. Add focused tests and verify the journey in the browser.
```

## Workflow 2: Turn product feedback into action

Use when feedback arrives as an informal statement rather than a specification.

```text
Feedback: "I cannot tell which cases are urgent."
        |
        v
Observed friction: urgency is hidden inside priority and timestamps
        |
        v
Product hypothesis: explicit SLA states improve triage
        |
        v
Slice: due time + on-track/at-risk/overdue + priority recalculation
        |
        v
Evidence: tests + browser flow + audit event + analyst feedback
```

Codex can help translate the statement into a hypothesis, affected surfaces,
edge cases, and instrumentation. The product owner decides whether the problem
is strategically important.

## Workflow 3: Work with messy payment data

1. Preserve the raw source files and report their names.
2. Profile headers, nulls, duplicate identifiers, number formats, and statuses.
3. Map aliases into a typed canonical schema.
4. Reject or visibly classify records that cannot be interpreted.
5. Reconcile with deterministic rules.
6. Store row-level evidence for every exception.
7. Add new fixtures and tests before supporting a new provider format.

AI may help propose mappings or explain anomalies, but it must not silently
rewrite source facts or calculate settlement truth.

## Workflow 4: Review a risky change

Ask Codex to review the diff with these lenses:

- **Correctness:** Does money-related arithmetic remain deterministic?
- **Tenancy:** Does every protected query include `organizationId`?
- **Authorization:** Can viewers mutate or non-admins inspect audit data?
- **AI safety:** Can generated text trigger or falsely claim money movement?
- **Data handling:** Are secrets or real payment records introduced?
- **Auditability:** Are important changes attributable to an actor?
- **Testing:** Which realistic failure path remains uncovered?

Findings should be ordered by severity and reference specific files and lines.

## Workflow 5: Prepare a portfolio release

1. Run all quality checks.
2. Walk the five-minute demo using each relevant persona.
3. Capture screenshots from the real application.
4. Recalculate repository metrics rather than guessing.
5. Update limitations and roadmap.
6. Review the README as a hiring manager with two minutes of attention.
7. Commit and push only after the evidence matches the claims.

## Useful specialist roles

These are review perspectives, not autonomous production actors.

| Role | Primary question | Expected output |
| --- | --- | --- |
| Payments product reviewer | Does this reflect a real operations workflow? | Assumptions, missing states, prioritization |
| Security and tenancy reviewer | Can one role or organization cross a boundary? | Ranked findings with code references |
| AI quality reviewer | Is output grounded, useful, and appropriately uncertain? | Evaluation results and failure examples |
| Data quality reviewer | Can messy files be normalized without silent corruption? | Schema risks, fixtures, validation rules |
| Portfolio reviewer | Is every claim understandable and evidenced? | README and demo improvements |

## Authority limits

An agent may:

- read and edit repository files;
- run local tests, builds, migrations, and browser checks;
- draft product and engineering documentation;
- prepare commits after reviewing scope.

An agent must request human authorization before:

- authenticating or pushing to an external service when permission is absent;
- installing or accessing a new external system;
- using real customer or payment data;
- making a destructive database or Git operation;
- changing the product's money-movement or AI authority boundary.

No agent in this project is authorized to move money or act on behalf of an
operations analyst.

## Reusable prompt templates

### Product slice

```text
Inspect the repository and implement [user outcome].
Users: [roles/personas].
Business rules: [rules].
Do not change: [boundaries].
Done when: [tests, browser flow, docs, Git outcome].
```

### Feedback triage

```text
Turn this feedback into: observed problem, affected persona, evidence needed,
three solution options, recommended smallest slice, success metric, and risks.
Then inspect the repository and implement the recommendation if it is supported
by the current product direction.
```

### Messy dataset

```text
Profile these synthetic files for schema drift, duplicate identifiers, missing
values, invalid amounts, and status variants. Propose a canonical schema and
validation report. Do not discard or modify source rows silently.
```

---

[Back to README](../../README.md) |
[AI Development System](AI-DEVELOPMENT-SYSTEM.md) |
[Analytics Event Spec](ANALYTICS-EVENT-SPEC.md)

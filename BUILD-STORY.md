# How PayOps Copilot Was Built

> An honest chronology of how a payments-domain PM used Codex to move from an
> idea to a full-stack, database-backed, role-aware operations product.

## TL;DR

I started with domain knowledge, not an internal specification or engineering
team. I knew the operational pain: merchant order reports, gateway exports,
and bank settlements rarely line up cleanly, and finding a mismatch is only the
start of the work.

Codex helped convert that knowledge into a working system in ten milestones.
The productive pattern was not "ask AI to build an app." It was a repeated
loop of narrowing the problem, inspecting the current repository, building one
coherent vertical slice, verifying it in the database and browser, and pushing
the evidence to GitHub.

## Starting position

My background is payment aggregators and fintech in India. I was comfortable
with the domain language - orders, gateway references, MDR, GST, UTRs,
settlements, exceptions, operations queues - but not with assembling a modern
full-stack application.

There were no internal documents to import. That constraint was useful:

- the problem statement had to be expressed in plain language;
- every policy assumption had to be visible in the product;
- demo data had to be synthetic and safe for a public repository;
- the project had to teach a non-payments reviewer while still feeling credible
  to someone who has run payment operations.

## The ten milestones

The dates and commits below come directly from the repository history.

| Date | Commit | Milestone |
| --- | --- | --- |
| June 12, 2026 | `85b09d9` | Built the reconciliation MVP and synthetic three-report journey |
| June 12, 2026 | `72346a6` | Added PostgreSQL persistence and the operations-case backend |
| June 12, 2026 | `5fe52b8` | Added evidence-grounded AI investigations and human review |
| June 13, 2026 | `1e9a986` | Added organizations, authentication, roles, and audit controls |
| June 14, 2026 | `8e083e1` | Added SLA policy, alerts, filters, and deadline auditability |
| June 15, 2026 | `60456e7` | Added a 30-case evaluation harness, prompt versioning, and Quality Lab |
| June 15, 2026 | `6a4f9dc` | Persisted evaluation history, scenario results, roles, and audit evidence |
| June 15, 2026 | `1597d5f` | Added case-level outputs, six-score review, notes, attribution, and audit |
| June 15, 2026 | `489d5dd` | Added guarded OpenAI execution with latency and token evidence |
| June 15, 2026 | `ae7cea0` | Added refunds, chargebacks, evidence gates, deadlines, and timelines |

### Milestone 1: Make the payment logic visible

The first version answered one question: can three inconsistent reports be
turned into an understandable reconciliation result?

The product normalized common headers, matched records, calculated expected net
settlement after fee and tax, and explained each exception with row-level
evidence. The distinct port `4317` became a small but important operating rule
after an early local-server connection issue: keep the environment predictable
and verify the exact URL.

### Milestone 2: Turn findings into work

A reconciliation result that disappears on refresh is a demonstration, not an
operations product. PostgreSQL made runs durable and converted actionable
exceptions into cases with owner, priority, status, and notes.

This was the first major learning loop for me as a non-engineer: the frontend is
only one view of the product. The database schema and API contracts determine
whether the workflow is real.

### Milestone 3: Put AI in the right place

The tempting design was to let AI "do reconciliation." I rejected that.
Financial arithmetic and matching remain deterministic because those outputs
must be reproducible.

AI was placed downstream of the evidence. It receives one selected case and
returns a structured hypothesis, confidence, supporting evidence,
recommended actions, limitations, and a draft provider message. A human must
approve or reject the result. Without an API key, the product uses a labeled
rules-based fallback instead of pretending AI ran.

### Milestone 4: Add organizational accountability

The next question was not "what feature looks impressive?" It was "what would
make this believable as an internal fintech product?"

That led to:

- organization-scoped reads and writes;
- admin, analyst, and viewer roles;
- read-only controls for viewers;
- administrator-only audit access;
- actor and entity details on important events.

Codex implemented the migration, credentials flow, server-side route guards,
frontend states, seed users, and browser verification. I authorized the
GitHub actions and reviewed the role journey.

### Milestone 5: Make urgency measurable

Cases need deadlines, not just priorities. High, medium, and low priority cases
received 4-hour, 24-hour, and 72-hour targets. Existing cases were backfilled
from their original creation times, which made the local demo immediately show
realistic overdue work.

The browser test proved the complete behavior: an admin could filter overdue
cases, inspect a deadline, change a case from high to low priority, see the
deadline recalculate, and find the update in the audit ledger.

### Milestone 6: Make AI quality testable

The AI evaluation plan became executable rather than remaining a document. A
versioned synthetic dataset now covers 30 payment cases across amount mismatch,
duplicate, missing gateway, missing settlement, pending, matched-control, and
adversarial-note scenarios.

The deterministic baseline runs 180 automated checks for evidence grounding,
financial safety, uncertainty, action quality, provider-message behavior, and
structured completeness. The Quality Lab explains those results inside the
product. Prompt versions are stored with new investigations so future model
comparisons can be reconstructed.

The result is deliberately bounded: passing the deterministic baseline is not
presented as proof that an OpenAI model has passed human review.

### Milestone 7: Turn evaluation into an accountable workflow

A command-line result is reproducible, but it does not show who ran it or make
comparisons durable. The next slice added an authenticated product action for
admins and analysts, while viewers retain read-only access to quality history.

Each run now stores dataset, prompt, provider, model, aggregate checks, seven
scenario summaries, initiating user, and timestamp in PostgreSQL. The operation
is organization-scoped, transactional, and recorded as `evaluation.completed`
in the audit ledger. This creates the data model needed for future model-version
comparisons without claiming those comparisons have happened yet.

### Milestone 8: Separate automated checks from human judgment

Run-level metrics could show that checks passed, but reviewers still needed to
inspect the actual evidence and output. The next migration stores all 30 case
inputs, generated analyses, automated checks, and scores for every new run.

The Quality Lab now provides a case navigator and a six-dimension human rubric:
grounding, financial safety, uncertainty, action quality, provider-message
quality, and completeness. Admins and analysts can save scores and notes;
viewers remain read-only. Each review stores the reviewer and timestamp and
creates an `evaluation_case.reviewed` audit event.

One synthetic case was reviewed during browser verification to prove the
workflow. That is implementation evidence, not a representative human
evaluation result.

### Milestone 9: Make model evaluation executable and observable

The same versioned 30-case dataset can now run through the OpenAI Responses API
from the Quality Lab. This path is explicit rather than automatic: the UI warns
that it makes 30 paid calls, requires `OPENAI_API_KEY`, and never silently
substitutes the deterministic fallback.

Each run stores provider, model, duration, input tokens, output tokens, and
total tokens. Each case stores its own latency and usage alongside the generated
analysis and automated checks. Migration `008` added the observability fields.
No OpenAI run completed during this milestone. A local key later reached the
API, but the project returned `insufficient_quota`, so completed model runs and
model-quality claims remain zero.

### Milestone 10: Model refunds and chargebacks as real operations

Refunds and chargebacks were added as distinct lifecycle objects instead of
being squeezed into reconciliation exceptions. Six synthetic records make the
workflow understandable immediately: exposure, owners, deadlines, evidence
completion, stages, notes, and decision history all live in PostgreSQL.

The browser journey exposed a product flaw during verification: a chargeback
could be moved to `evidence_submitted` while its checklist was only 75%
complete. The final implementation disables that stage in the UI and rejects
it at the API until every evidence item is complete. Each accepted change adds
a workflow timeline event and an organization-scoped audit event.

### Architecture refactor: Replace the central repository

After the tenth product milestone, the backend's single `lib/repository.ts`
had grown to 937 lines across seven business areas. It was replaced with
domain-owned repositories for reconciliation, cases, investigations,
evaluations, payment workflows, audit, and system health.

The application remains one Next.js deployment and one PostgreSQL database.
Routes now import only the module they serve, shared pooling remains in
`lib/db.ts`, and repository guidance prevents the catch-all file from
returning. This is a modular monolith, not a microservices claim.

The next refactor moved payment-workflow, case, evaluation, and investigation
validation plus audit orchestration into service files. Six mutation routes
became thin HTTP adapters. Focused service tests cover invalid lifecycle jumps,
chargeback evidence gates, case values, evaluation providers, six-score
reviews, and malformed or invalid investigation review payloads. The first two
architecture commits are `eea15a4` and `3bcf4ee`; the investigation service is
the next modular slice.

## The working workflow

This was the recurring delivery loop:

1. **State the product outcome in plain language.**
   Example: "help a non-payments, non-technical person understand the journey."
2. **Inspect before deciding.**
   Codex read the existing schema, routes, components, tests, and Git state.
3. **Choose the next vertical slice.**
   Database, API, UI, permissions, and documentation moved together.
4. **Explain the plan while working.**
   Short updates helped me understand what was changing and why.
5. **Implement against repository patterns.**
   New behavior reused Next.js routes, repository functions, migrations, and
   the existing visual system.
6. **Verify mechanically.**
   Lint, tests, TypeScript production build, migration execution, and diff
   checks were required.
7. **Verify as a user.**
   Codex drove the in-app browser through admin and viewer journeys and checked
   rendered states.
8. **Publish evidence.**
   The GitHub CLI was authorized, and each coherent milestone was committed and
   pushed to `main`.

This pattern aligns with OpenAI's current Codex guidance: provide the goal,
context, constraints, and definition of done; use durable repository
instructions for repeated conventions; and require tests and review rather than
stopping after code generation.

## Division of responsibility

| Human responsibility | Codex responsibility |
| --- | --- |
| Supply payment-domain context | Inspect and explain the current codebase |
| Decide which problem is worth solving next | Propose a scoped implementation |
| Correct domain assumptions | Implement database, API, frontend, and tests |
| Approve credentials, GitHub access, and risky actions | Request scoped approvals when required |
| Review the product and choose priorities | Run migrations, checks, and browser journeys |
| Own the final product claim | Report what passed, what changed, and what remains |

The important point is that human judgment did not disappear. AI reduced the
distance between product intent and a testable implementation.

## What went wrong and what changed

### The local server was not reachable

The first browser attempt showed a connection failure on `127.0.0.1:4317`.
The fix was not to guess. Codex checked the process, restarted the server, and
verified the listening port before reopening a fresh browser tab.

**Rule earned:** environment claims must be checked at the process and browser
layers.

### Documentation lagged behind implementation

After authentication and audit shipped, the README still listed them as future
roadmap items.

**Rule earned:** documentation is part of the feature's definition of done.

### Generated development files created Git noise

Next.js changed a generated type reference while the development server was
running.

**Rule earned:** inspect every diff and exclude generated churn that does not
belong to the product change.

### AI needed an explicit boundary

An investigation assistant can sound certain even when the uploaded reports do
not prove a provider-side event.

**Rule earned:** prompts, schemas, UI labels, fallbacks, and approval controls
must all reinforce the same boundary. Safety cannot live in one sentence.

## What I learned

1. **Start with one truthful workflow.** A small end-to-end product teaches more
   than a large set of disconnected screens.
2. **Look below the UI.** Migrations, constraints, organization filters, and
   audit writes are product decisions.
3. **Keep financial arithmetic deterministic.** AI is valuable for synthesis
   and drafting, not for deciding what amount settled.
4. **Use AI to verify its own work.** Tests and browser automation are higher
   leverage than accepting a confident "done."
5. **Publish the reasoning, not only the code.** Hiring managers need to see the
   problem selection, trade-offs, safeguards, and evidence.

## Honest current limits

This is a portfolio MVP, not a production payment system. It has synthetic
data, local credentials, a simple SLA calendar, and a focused test suite. It
does not ingest provider APIs or webhooks, initiate provider-side refunds, store
payment credentials, send notifications, or use production-derived labeled
evaluation data.

Those are not hidden gaps. They are the next product and engineering decisions,
documented in
[Roadmap and Trade-offs](docs/portfolio/ROADMAP-AND-TRADEOFFS.md).

---

Related: [README](README.md) |
[Product Case Study](docs/portfolio/PRODUCT-CASE-STUDY.md) |
[By the Numbers](docs/portfolio/BY-THE-NUMBERS.md)

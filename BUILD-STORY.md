# How PayOps Copilot Was Built

> An honest chronology of how a payments-domain PM used Codex to move from an
> idea to a full-stack, database-backed, role-aware operations product.

## TL;DR

I started with domain knowledge, not an internal specification or engineering
team. I knew the operational pain: merchant order reports, gateway exports,
and bank settlements rarely line up cleanly, and finding a mismatch is only the
start of the work.

Codex helped convert that knowledge into a working system in eighteen milestones.
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

## The eighteen milestones

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
| June 19, 2026 | current release | Added source-row integrity evidence and controlled case resolution |
| June 19, 2026 | current release | Added PostgreSQL-backed CI, tenancy attacks, and role tests |
| June 19, 2026 | current release | Extracted the operations-console design system and workflow components |
| June 19, 2026 | current release | Added independent reviewers, disagreement, and adjudication |
| June 20, 2026 | `4cd3cde` | Added deterministic Operations Intelligence and drill-through |
| June 20, 2026 | current release | Added bulk case dispatch and append-only handoff comments |
| June 22, 2026 | current release | Added deterministic settlement clocks and overdue promotion |

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

The next refactor moved payment-workflow, case, evaluation, investigation, and
reconciliation validation plus audit orchestration into service files. Seven
mutation routes became thin HTTP adapters. Focused service tests cover invalid
lifecycle jumps, chargeback evidence gates, case values, evaluation providers,
six-score reviews, malformed investigation reviews, and malformed
reconciliation requests. The first two architecture commits are `eea15a4` and
`3bcf4ee`; investigation and reconciliation services continued the modular
slice.

### Provider adapter foundation: Make schema drift visible

The next product slice added synthetic provider adapters for generic CSV,
Razorpay-style, Cashfree-style, and PayU-style reports. The point was not to
claim live integrations. It was to show the product shape needed before live
integrations: explicit field mappings, provider assumptions, row counts,
duplicate-reference warnings, invalid amount checks, and unknown status
warnings.

The reconciliation workspace now lets an analyst pick an adapter and see a
data-quality report alongside deterministic results. The browser journey proved
the generic demo path and a provider-mismatch warning path, including a 390px
mobile layout without horizontal overflow.

### Provider event timelines: Add context without live connectivity

The next slice added synthetic webhook fixtures for payment captures,
settlements, refunds, and chargebacks. A deterministic normalizer converts
Razorpay-style, Cashfree-style, and PayU-style payloads into one internal event
model.

Those events appear in operations cases and refund/chargeback workflows with
two explicit statements: what the event proves and what it does not prove. That
keeps the portfolio honest. The product can demonstrate event reasoning without
claiming live webhook ingestion, provider credentials, signature verification,
or production delivery guarantees.

### Milestone 11: Make financial evidence reconstructable

The evidence-integrity release persists the contributing order, gateway, and
settlement row snapshots for each new reconciliation item. Each snapshot keeps
the original row number, selected normalized values, retained source values,
and a SHA-256 integrity hash without storing the complete uploaded file.

Tenant-linked foreign keys keep runs, items, cases, and evidence inside the
same organization. Reconciliation creation and case updates now commit their
audit events in the same database transaction. A case cannot be resolved until
an analyst provides a reason, confirms the persisted evidence was reviewed, and
accepts resolver attribution.

### Milestone 12: Turn repository rules into executable gates

The next release replaced the self-attested PR checklist with one
`npm run verify` contract used locally and in GitHub Actions. CI starts a clean
PostgreSQL 17 service, applies every migration, and then runs lint, unit tests,
database integration tests, the production build, and diff checks.

The integration suite creates two organizations and attempts cross-tenant reads,
writes, and mixed-tenant relationships. It also forces a transaction failure to
prove that case mutations and audit events roll back together. Separate role
tests cover administrator, analyst, viewer, and unauthenticated behavior.

### Milestone 13: Make the interface system reusable

The frontend already had a distinct visual language, but repeated search
controls, source evidence, provider timelines, case queues, and resolution
controls were embedded in large workflow files. This release extracted those
patterns into `components/ui/`, `components/cases/`, and
`components/reconciliation/`.

The design-system document names the product direction—an evidence-dense
editorial operations console—and records its paper grid, ink borders, mono
control labels, semantic colors, responsive rules, and evidence-rail signature.
Domain components still own workflow state and mutations; shared components own
repeated presentation and accessibility.

### Milestone 14: Make human evaluation genuinely independent

The first Quality Lab stored one review directly on each case, which meant a
second reviewer would overwrite the first. The new schema adds two run-level
reviewer slots, reviewer-owned case scores, and a separate administrator
adjudication record.

Quality Lab now exposes assignment coverage, double-reviewed cases,
disagreements, adjudications, reviewer comparison, and aggregate human score.
Database integration tests prove that two reviewers remain independent and that
an adjudicated score supersedes their disagreement without deleting either
original judgment.

### Milestone 15: Make inbound evidence trustworthy without claiming live connectivity

The final roadmap slice turns the fictional provider-event model into a
controlled inbound boundary. A request is accepted only when its HMAC covers
the organization slug, external event ID, and exact body. PostgreSQL prevents
replay within an organization and provider, while persistence keeps only a
SHA-256 body hash and the deterministic normalized event.

Matching events appear beside the existing case and payment-workflow evidence.
The header evidence inbox also surfaces linked provider events and cases that
enter the last 25% of their SLA or become overdue. Read state is
organization-scoped, viewer-safe, and audited for administrators and analysts.
Nothing in the release contacts a provider, sends an external notification, or
moves money.

### Milestone 16: Turn operational records into management decisions

The next slice adds a deterministic Operations Intelligence workspace rather
than a disconnected analytics mockup. PostgreSQL calculates period comparisons,
queue health, exception mix, workload aging, provider performance, SLA outcome,
AI review evidence, and signed inbound-event counts from organization-scoped
records.

Every distribution remains actionable: chart bars and provider rows open the
existing operations queue with shareable URL filters, and direct case links
select the underlying record. An idempotent fictional-history seed creates a
meaningful clean-install demo while preserving all user-created runs.

### Milestone 17: Make queue collaboration operational

The next operations slice reduces repetitive ownership updates without turning
the queue into an opaque automation surface. Admins and analysts mark cases
directly on the ledger, then assign or unassign the bounded selection in one
organization-scoped transaction.

Each case also gains an attributed handoff log. Comments are append-only,
viewer-readable, and audited alongside the operational write, preserving the
existing distinction between mutable working notes and durable collaboration
history.

### Milestone 18: Separate settlement lateness from case urgency

The Settlement Control release adds a second deterministic clock. Fictional
provider and payment-mode policies calculate when a successful transaction is
expected to settle after IST cutoffs, weekends, and versioned synthetic
closures. Those inputs and the full calculation snapshot persist beside the
financial evidence.

A missing settlement now remains monitored while it is not due or due today.
Only an overdue record creates an operations case, either during reconciliation
or through an audited idempotent refresh. The UI keeps that settlement clock
visually separate from the case SLA, and Insights excludes incomplete timing
evidence from provider on-time denominators.

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
does not connect to provider APIs, claim production webhook compatibility,
initiate provider-side refunds, store payment credentials or raw webhook
payloads, send external notifications, or use production-derived labeled
evaluation data.

Those are not hidden gaps. They are the next product and engineering decisions,
documented in
[Roadmap and Trade-offs](docs/portfolio/ROADMAP-AND-TRADEOFFS.md).

---

Related: [README](README.md) |
[Product Case Study](docs/portfolio/PRODUCT-CASE-STUDY.md) |
[By the Numbers](docs/portfolio/BY-THE-NUMBERS.md)

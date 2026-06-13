# How PayOps Copilot Was Built

> An honest chronology of how a payments-domain PM used Codex to move from an
> idea to a full-stack, database-backed, role-aware operations product.

## TL;DR

I started with domain knowledge, not an internal specification or engineering
team. I knew the operational pain: merchant order reports, gateway exports,
and bank settlements rarely line up cleanly, and finding a mismatch is only the
start of the work.

Codex helped convert that knowledge into a working system in five milestones.
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

## The five milestones

The dates and commits below come directly from the repository history.

| Date | Commit | Milestone |
| --- | --- | --- |
| June 12, 2026 | `85b09d9` | Built the reconciliation MVP and synthetic three-report journey |
| June 12, 2026 | `72346a6` | Added PostgreSQL persistence and the operations-case backend |
| June 12, 2026 | `5fe52b8` | Added evidence-grounded AI investigations and human review |
| June 13, 2026 | `1e9a986` | Added organizations, authentication, roles, and audit controls |
| June 14, 2026 | `8e083e1` | Added SLA policy, alerts, filters, and deadline auditability |

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
data, local credentials, a simple SLA calendar, and a small test suite. It does
not ingest provider APIs, initiate refunds, store payment credentials, send
notifications, or contain a labeled evaluation dataset for the AI assistant.

Those are not hidden gaps. They are the next product and engineering decisions,
documented in
[Roadmap and Trade-offs](docs/portfolio/ROADMAP-AND-TRADEOFFS.md).

---

Related: [README](README.md) |
[Product Case Study](docs/portfolio/PRODUCT-CASE-STUDY.md) |
[By the Numbers](docs/portfolio/BY-THE-NUMBERS.md)

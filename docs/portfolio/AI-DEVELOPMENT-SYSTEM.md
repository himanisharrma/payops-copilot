# AI Development System

> How a payments-domain product manager used Codex to turn product judgment into
> a working, reviewable full-stack product.

## The operating model

Codex was used as a repository-aware engineering collaborator. The human did
not need to prescribe every file or implementation detail, but did remain
responsible for the problem, priorities, domain assumptions, and acceptance of
the result.

```text
Domain context
    -> product slice and acceptance criteria
    -> repository inspection
    -> implementation across data, API, UI, and tests
    -> browser walkthrough
    -> diff and safety review
    -> commit and GitHub evidence
```

## Division of responsibility

| Human product owner | Codex |
| --- | --- |
| Explain payment-operations reality | Inspect the repository and translate it into code changes |
| Choose which problem is worth solving | Propose a bounded implementation slice |
| Correct inaccurate assumptions | Implement database, API, UI, tests, and documentation |
| Decide risk tolerance and product boundaries | Run local services and verification commands |
| Authorize GitHub and external actions | Walk the product in the browser and report evidence |
| Accept or reject the outcome | Commit and push approved work |

This is not "AI built it alone." It is an example of domain expertise directing
an agent that can operate across a software repository.

## A good task brief

Each substantial task should contain:

```text
Goal: What user outcome should exist?
Context: What business or technical facts matter?
Constraints: What must never happen?
Done when: What observable evidence proves completion?
```

Example:

```text
Goal: Help an operations lead see which reconciliation cases need attention.
Context: High-priority exceptions have a four-hour SLA.
Constraints: Do not change financial calculations or expose another tenant.
Done when: The inbox shows due time and SLA state, priority changes recalculate
the deadline, tests pass, and the journey works in the browser.
```

## Why repository context matters

Before changing code, Codex should inspect:

- nearby implementation and test files;
- domain services, repository queries, and database migrations;
- role and organization access rules;
- product documentation and existing terminology;
- the current Git diff, so unrelated user work is preserved.

The durable version of that context now lives in [`AGENTS.md`](../../AGENTS.md).
It prevents every future session from rediscovering the product's most
important boundaries.

## Verification ladder

Every change should move through progressively stronger evidence:

1. **Static:** TypeScript, lint, formatting, and diff checks.
2. **Behavioral:** focused unit tests for deterministic logic.
3. **Integrated:** production build and PostgreSQL-backed API behavior.
4. **Experiential:** browser walkthrough using the actual role and workflow.
5. **Portfolio:** documentation, screenshots, commit history, and bounded claims.

Passing a build is necessary but does not prove that the product makes sense to
an operations analyst.

## Prompting patterns that worked

### Ask for outcomes, not filenames

Weak:

```text
Create a component and an API.
```

Stronger:

```text
Create a case-management journey where analysts can own, prioritize, investigate,
and resolve a reconciliation exception. Preserve organization scoping and record
important actions in the audit ledger.
```

### Make uncertainty explicit

Codex should label assumptions and inspect the application before deciding.
The product owner should correct payment-domain assumptions that are inaccurate.

### Name the completion evidence

Useful terminal conditions include:

- a real browser flow works;
- a migration applies to PostgreSQL;
- role behavior is demonstrated;
- tests cover a new policy;
- the result is committed and visible on GitHub.

## Failure modes and controls

| Failure mode | Control |
| --- | --- |
| A polished UI hides missing persistence | Verify reloads and query PostgreSQL-backed APIs |
| AI is used for arithmetic | Keep reconciliation in deterministic typed code |
| A route check exists but SQL leaks tenants | Require `organizationId` in repository operations |
| Business rules drift across API handlers | Put validation and orchestration in domain services |
| Documentation becomes marketing fiction | Link claims to code, screenshots, tests, or commits |
| A large change is hard to review | Ship vertical product slices with focused commits |
| The agent stops after implementation | Include test, browser, review, and GitHub in "done" |

## Current development loop

```bash
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev -- --hostname 127.0.0.1 --port 4317
npm run lint
npm test
npm run build
git diff --check
```

The unique local port avoids collisions with common development servers and is
used consistently in the README and demo guide.

## What this demonstrates

For an AI product-management role, the evidence is not simply that Codex was
used. The stronger signal is that the collaboration produced:

- explicit AI and financial-risk boundaries;
- a coherent multi-step product journey;
- full-stack implementation and operational persistence;
- measurable review and feedback points;
- honest documentation of limitations and trade-offs.

---

[Back to README](../../README.md) |
[AI Workflows and Agents](AI-WORKFLOWS-AND-AGENTS.md) |
[AI SDLC Playbook](AI-SDLC-PLAYBOOK.md)

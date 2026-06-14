# PayOps Copilot Repository Guide

This file gives coding agents durable context for work in this repository.
Treat it as an operating contract, not as product documentation.

## Product intent

PayOps Copilot helps Indian payment-operations teams reconcile internal orders,
gateway transactions, and bank settlements. It turns exceptions into
organization-scoped cases with ownership, SLAs, evidence, AI-assisted
investigations, human review, and audit history.

The product is a portfolio MVP. All demo data is synthetic. It must never imply
that it connects to live payment providers or can move money.

## Non-negotiable boundaries

- Financial truth must come from deterministic TypeScript code and persisted
  source evidence, never from a language model.
- AI may explain a case, identify hypotheses, recommend verification steps, and
  draft a provider query.
- AI must not issue refunds, alter financial records, resolve cases, contact a
  provider, or claim knowledge of provider-side events.
- Human approval remains required for AI investigations.
- Every protected database query must be scoped by `organizationId`.
- Mutations require `admin` or `analyst`; audit reads require `admin`.
- Never commit credentials, real payment data, card data, bank data, or personal
  customer information.

## Architecture map

- `app/`: Next.js pages and API route handlers.
- `components/`: client-facing product workflows.
- `lib/reconciliation.ts`: deterministic normalization, matching, and arithmetic.
- `lib/ai-investigator.ts`: bounded OpenAI and deterministic fallback paths.
- `lib/repository.ts`: PostgreSQL persistence and organization-scoped queries.
- `lib/access.ts`: authentication and role checks.
- `lib/sla.ts`: SLA policy and status calculation.
- `db/migrations/`: ordered SQL migrations; never rewrite an applied migration.
- `scripts/`: database migration and seed utilities.
- `docs/portfolio/`: product, architecture, AI, demo, and portfolio evidence.

## Working method

1. Read the relevant code, tests, migrations, and documentation before editing.
2. State the user outcome and completion conditions in plain language.
3. Make the smallest complete change across database, API, UI, tests, and docs.
4. Use existing repository patterns unless there is a concrete reason to change.
5. Exercise the real browser journey for user-facing changes.
6. Review the diff for security, tenancy, AI safety, and unsupported claims.
7. Run the required checks before committing.

## Required checks

```bash
npm run lint
npm test
npm run build
git diff --check
```

For database changes:

- add a new numbered migration;
- test migration against the local PostgreSQL container;
- preserve existing data and constraints;
- update `.env.example` only with safe placeholders.

For AI changes:

- preserve structured Zod output;
- keep `store: false` unless the privacy decision is explicitly revisited;
- include model and prompt/version metadata when the schema supports it;
- test deterministic fallback behavior;
- evaluate evidence grounding and prohibited actions;
- do not weaken the human-review step.

## Definition of done

A change is complete when the intended user journey works, authorization and
organization scoping are preserved, important behavior is tested, documentation
matches reality, and the repository passes all required checks.

# By the Numbers

> Every implemented-project figure below was measured from the AI-quality
> working snapshot prepared on June 15, 2026. It is repository evidence, not a
> production-performance claim.

## Delivery

| Metric | Value | Evidence |
| --- | --- | --- |
| Build window represented in Git | June 12-15, 2026 | `git log --reverse` |
| Product milestones | 7 vertical slices | `BUILD-STORY.md` |
| First milestone | Reconciliation MVP | commit `85b09d9` |
| Latest product milestone | Persisted evaluation operations | `/api/evaluations`, migration `006` |

## Codebase snapshot

| Metric | Value | Reproducible command or path |
| --- | --- | --- |
| Repository files | 80 | `git ls-files --cached --others --exclude-standard` |
| TypeScript and TSX lines | 4,346 | repository file list piped to `wc -l` |
| Next.js API route files | 10 | `find app/api -name route.ts` |
| PostgreSQL migrations | 6 | `db/migrations/` |
| Automated test cases | 12 | `rg '\\bit\\(' --glob '*.test.ts'` |
| Demo CSV reports | 3 | `public/demo/` |
| Product pages | 7 | Adds `/quality` to the six original pages |
| Synthetic AI evaluation cases | 30 | `evals/payment-investigations-v1.ts` |
| Baseline automated checks | 180 | 30 cases x 6 evaluation dimensions |
| Persisted scenario rows per run | 7 | one summary for each evaluation scenario |

## Product surface

| Capability | Implemented evidence |
| --- | --- |
| Reconciliation result states | 6 typed states in `lib/types.ts` |
| Application roles | 3 roles in `lib/access.ts` and the user schema |
| SLA targets | 4, 24, and 72 hours in `lib/sla.ts` |
| Organization-scoped repositories | organization predicates in `lib/repository.ts` |
| AI output fields | 6 structured fields in `InvestigationSchema` |
| Human AI review states | pending, approved, rejected |
| AI feedback states | helpful, not helpful |
| Audited entity workflows | reconciliation, case, investigation, evaluation |
| Versioned AI inputs | dataset, prompt, provider, and model identifiers |
| Evaluation authorization | admin/analyst run, all roles read within organization |

## Quality evidence

At the documentation snapshot:

```text
npm run lint   -> pass
npm test       -> 4 test files, 12 tests passing
npm run eval   -> 30 cases, 180 checks, 0 critical baseline failures
npm run build  -> production compilation and TypeScript checks pass
```

Browser verification also exercised:

- admin login and audit access;
- viewer read-only behavior;
- synthetic reconciliation persistence;
- operations-case loading;
- overdue filtering;
- deadline inspection;
- priority-driven SLA recalculation;
- audit-event creation;
- persisted evaluation execution and history rendering.

## What is not measured

The project does not claim:

- production transaction volume;
- reconciliation accuracy on real provider data;
- analyst time savings;
- production SLA performance;
- AI accuracy, acceptance rate, or cost;
- OpenAI model quality or human-review pass rates;
- security certification or regulatory compliance.

Those require a real pilot, production telemetry, labeled data, and formal
controls. The separation is deliberate: repository evidence is presented as
repository evidence, and future product metrics remain hypotheses.

## Commands

Reproduce the core counts from the repository root:

```bash
git ls-files --cached --others --exclude-standard | sort -u | wc -l
git ls-files --cached --others --exclude-standard '*.ts' '*.tsx' |
  xargs wc -l
find app/api -name route.ts | wc -l
find db/migrations -name '*.sql' | wc -l
npm test
npm run eval
```

---

[Back to README](../../README.md) |
[Build Story](../../BUILD-STORY.md)

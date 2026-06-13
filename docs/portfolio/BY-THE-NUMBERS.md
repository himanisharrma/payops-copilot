# By the Numbers

> Every implemented-project figure below was measured from commit `8e083e1`,
> immediately before the Phase 1 portfolio documentation work. It is a
> repository snapshot, not a production-performance claim.

## Delivery

| Metric | Value | Evidence |
| --- | --- | --- |
| Build window represented in Git | June 12-14, 2026 | `git log --reverse` |
| Product milestones | 5 commits | `git rev-list --count 8e083e1` |
| First milestone | Reconciliation MVP | commit `85b09d9` |
| Latest pre-doc milestone | SLA tracking and alerts | commit `8e083e1` |

## Codebase snapshot

| Metric | Value | Reproducible command or path |
| --- | --- | --- |
| Tracked files | 55 | `git ls-files \| wc -l` |
| TypeScript and TSX lines | 3,457 | `git ls-files '*.ts' '*.tsx' \| xargs wc -l` |
| Next.js API route files | 9 | `find app/api -name route.ts` |
| PostgreSQL migrations | 4 | `db/migrations/` |
| Automated test cases | 8 | `rg '\\b(it\|test)\\(' --glob '*.{test,spec}.{ts,tsx,js,jsx}'` |
| Demo CSV reports | 3 | `public/demo/` |
| Product pages | 6 | `/`, `/login`, `/operations`, `/runs`, `/audit`, `/product-brief` |

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
| Audited entity workflows | reconciliation, case, investigation |

## Quality evidence

At the documentation snapshot:

```text
npm run lint   -> pass
npm test       -> 3 test files, 8 tests passing
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
- audit-event creation.

## What is not measured

The project does not claim:

- production transaction volume;
- reconciliation accuracy on real provider data;
- analyst time savings;
- production SLA performance;
- AI accuracy, acceptance rate, or cost;
- security certification or regulatory compliance.

Those require a real pilot, production telemetry, labeled data, and formal
controls. The separation is deliberate: repository evidence is presented as
repository evidence, and future product metrics remain hypotheses.

## Commands

Reproduce the core counts from the repository root:

```bash
git rev-list --count 8e083e1
git ls-tree -r --name-only 8e083e1 | wc -l
git ls-tree -r --name-only 8e083e1 |
  grep -E '\.(ts|tsx)$' |
  xargs -I{} git show 8e083e1:{} |
  wc -l
find app/api -name route.ts | wc -l
find db/migrations -name '*.sql' | wc -l
npm test
```

---

[Back to README](../../README.md) |
[Build Story](../../BUILD-STORY.md)

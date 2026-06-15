# Backend Modules

PayOps Copilot uses a modular monolith: one deployable Next.js application with
domain-owned backend code and a shared PostgreSQL connection.

```text
API route (transport and request validation)
  -> domain policy/service
  -> domain repository
  -> shared database transaction/query
```

| Module | Owns |
| --- | --- |
| `reconciliation` | Reconciliation runs, items, and run history |
| `cases` | Operations cases, ownership, priority, status, and SLA data |
| `investigations` | AI investigation persistence and human review |
| `evaluations` | Evaluation runs, case results, and reviewer scoring |
| `payment-workflows` | Refunds, chargebacks, evidence, and timeline events |
| `audit` | Organization-scoped audit writes and administrator reads |
| `system` | Database health checks |

API routes import the module they serve. Cross-domain calls use public module
exports. `lib/db.ts` remains the only shared connection and transaction utility.
Financial and lifecycle rules stay in domain policy files. Do not recreate a
central repository.

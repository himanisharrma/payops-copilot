# Backend Modules

PayOps Copilot uses a modular monolith: one deployable Next.js application with
domain-owned backend code and a shared PostgreSQL connection.

```text
API route (transport and request validation)
  -> domain policy/service
  -> domain repository
  -> shared database transaction/query
```

| Module | Repository | Service | Owns |
| --- | --- | --- | --- |
| `reconciliation` | Yes | Yes | Provider profiling, request validation, deterministic execution, persistence, and audit |
| `cases` | Yes | Yes | Ownership, priority, status, SLA, and audited updates |
| `investigations` | Yes | Yes | AI execution, persistence, review validation, and audit |
| `evaluations` | Yes | Yes | Runs, case results, reviewer scoring, and audit |
| `payment-workflows` | Yes | Yes | Refunds, chargebacks, evidence gates, timelines, and audit |
| `provider-events` | Yes | Yes | Signed synthetic ingestion, idempotency, normalization persistence, and matching |
| `notifications` | Yes | Yes | SLA/provider signals, organization inbox, read policy, and audit |
| `audit` | Yes | No | Organization-scoped writes and administrator reads |
| `system` | Yes | No | Database health checks |

API routes import the module they serve. Cross-domain calls use public module
exports. `lib/db.ts` remains the only shared connection and transaction utility.
Services validate business input, coordinate repositories, and write audit
evidence. Routes only handle authentication, JSON, and HTTP responses.
Financial and lifecycle rules stay in domain policy files. Do not recreate a
central repository or move orchestration back into routes.

Synthetic provider mapping lives in `lib/provider-adapters.ts`. Synthetic
provider webhook normalization lives in `lib/provider-webhooks.ts`. The
provider-events module exposes a signed synthetic ingestion boundary that
stores normalized evidence and body hashes, not raw payloads or credentials.
These remain deterministic demo policies, not live integrations.

`DomainError` is the shared service-to-transport error contract. Services throw
domain errors with HTTP-safe status codes; API routes translate them through
`lib/api-errors.ts` without learning repository details.

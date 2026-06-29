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
| `cases` | Yes | Yes | Ownership, bulk dispatch, append-only comments, priority, status, SLA, and audited updates |
| `investigations` | Yes | Yes | AI execution, persistence, review validation, and audit |
| `evaluations` | Yes | Yes | Runs, case results, reviewer scoring, and audit |
| `payment-workflows` | Yes | Yes | Refunds, chargebacks, evidence gates, timelines, and audit |
| `provider-events` | Yes | Yes | Versioned synthetic signature verification, key rotation, idempotency, hash-only attempt evidence, normalization, matching, and trust observability |
| `source-ingestion` | Yes | Yes | Expected-file registry, synthetic arrival SLA, CSV profiling, duplicate/revision/quarantine classification, readiness, and audit |
| `notifications` | Yes | Yes | SLA/provider signals, organization inbox, read policy, and audit |
| `insights` | Yes | Yes | Deterministic period metrics, current queue health, provider comparison, and drill-down contracts |
| `settlement-control` | Yes | Yes | Idempotent overdue promotion, organization locking, and audit |
| `close-control` | Yes | Yes | Daily scope readiness, materiality, immutable versions, residual dispositions, maker-checker approval, reopen policy, certificates, and audit |
| `remediation-programs` | Yes | Yes | Deterministic recurrence detection, lifecycle, automatic case linking, clean-run verification, and audit evidence |
| `merchant-settlements` | Yes | Yes | Merchant settlement batches, lines, deductions, bank credits, UTR classification, settlement arithmetic, and `loadSettlementSourceForLedger` helper for the ledger bridge |
| `settlement-imports` | Yes | Yes | Imported settlement rows, comparison snapshots, exception inventory, adjustment proposal lifecycle, and evidence packet export |
| `manual-matches` | Yes | Yes | Analyst-facing manual match / unmatch override records with admin maker-checker on unmatches and audit |
| `refund-allocations` | Yes | Yes | Refund netting allocations linked to parent capture (cross-run), `refund_offset_recognized` stamping, and ledger bridge for refund netting |
| `ledger` | Yes | Yes | Append-only double-entry journal — chart of accounts per merchant, posting recipes, balanced-pair guard, idempotency, getBalance / getProviderReceivableBreakdown / listTransactions / reverseTransaction |
| `audit` | Yes | No | Organization-scoped writes and administrator reads |
| `system` | Yes | No | Database health checks |

API routes import the module they serve. Cross-domain calls use public module
exports. `lib/db.ts` remains the only shared connection and transaction utility.
Services validate business input, coordinate repositories, and write audit
evidence. Routes only handle authentication, JSON, and HTTP responses.
Financial and lifecycle rules stay in domain policy files. Do not recreate a
central repository or move orchestration back into routes.

Close Control reads persisted reconciliation and case evidence. Its service
validates materiality and every residual disposition, while PostgreSQL stores
immutable version snapshots and prevents the preparer from becoming the
approver. Reopening changes period state but never edits an approved version.

Synthetic provider mapping lives in `lib/provider-adapters.ts`. Synthetic
provider webhook normalization lives in `lib/provider-webhooks.ts`. The
provider-events module exposes a signed synthetic ingestion boundary that
stores normalized evidence, body hashes, signature version, key ID, outcome,
failure code, and processing time, not raw payloads or credentials. Its
administrator read model is organization-scoped and reports synthetic attempt
evidence rather than production delivery reliability.
These remain deterministic demo policies, not live integrations.

`DomainError` is the shared service-to-transport error contract. Services throw
domain errors with HTTP-safe status codes; API routes translate them through
`lib/api-errors.ts` without learning repository details.

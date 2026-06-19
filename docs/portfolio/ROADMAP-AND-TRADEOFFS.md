# Roadmap and Trade-offs

> Product judgment is visible in what was not built as much as in what was.

## Decisions made

### ADR-1: Deterministic reconciliation over AI reconciliation

**Chose:** typed normalization, matching, fee/tax arithmetic, and rule-based
status classification.

**Over:** asking a language model to compare rows or calculate settlement
amounts.

**Why:** financial outputs must be reproducible, testable, and explainable.

**Cost accepted:** provider-specific rules require explicit engineering rather
than prompt changes.

### ADR-2: AI after evidence, not before it

**Chose:** generate an investigation only after a persisted case contains a
status, identifiers, amounts, and evidence.

**Over:** a general chat interface over uploaded spreadsheets.

**Why:** a narrow context reduces unsupported claims and creates a reviewable
contract.

**Cost accepted:** the assistant cannot answer broad operational questions yet.

### ADR-3: Structured output over free text

**Chose:** Zod-validated fields for cause, confidence, evidence, actions,
message, and limitations.

**Over:** storing arbitrary model prose.

**Why:** the UI, audit model, feedback system, and versioned evaluation set need
a stable shape.

**Cost accepted:** schema changes require coordinated code changes.

### ADR-4: Human approval over autonomous action

**Chose:** explicit pending, approved, and rejected investigation states.

**Over:** allowing the model to resolve a case, send a message, or trigger a
refund.

**Why:** uploaded reports cannot prove provider-side events, and operational
accountability must remain with a person.

**Cost accepted:** slower automation and continued analyst effort.

### ADR-5: PostgreSQL over browser-only state

**Chose:** durable runs, cases, investigations, users, and events.

**Over:** a purely client-side portfolio demo.

**Why:** ownership, history, organization boundaries, and auditability require
persistence and constraints.

**Cost accepted:** local Docker setup and migration management.

### ADR-6: Organization scoping in the repository layer

**Chose:** pass `organizationId` into every protected repository operation.

**Over:** filtering only in the UI or relying only on route checks.

**Why:** tenancy is a data-access invariant, not a visual feature.

**Cost accepted:** more explicit function signatures and SQL predicates.

### ADR-7: Fixed SLA policy for the MVP

**Chose:** high 4 hours, medium 24 hours, low 72 hours.

**Over:** configurable calendars, holidays, queues, and customer contracts.

**Why:** a simple policy makes urgency measurable and demonstrates the workflow
without building a policy engine first.

**Cost accepted:** deadlines currently count elapsed hours, including weekends
and holidays.

### ADR-8: Synthetic CSV data over live integrations

**Chose:** three public fictional reports.

**Over:** sandbox credentials or real provider exports.

**Why:** the repository must be safe to clone, run, and review.

**Cost accepted:** integration reliability and provider-specific behavior are
not demonstrated.

### ADR-9: Credentials authentication for the portfolio

**Chose:** seeded fictional users with Auth.js and password hashing.

**Over:** implementing enterprise SSO for a local MVP.

**Why:** roles and organization boundaries needed to be experienced, while
production identity was outside the current proof.

**Cost accepted:** local credentials must be replaced before real use.

### ADR-10: One full-stack repository

**Chose:** Next.js pages and APIs, PostgreSQL migrations, tests, and docs in one
repository.

**Over:** separate frontend, backend, and documentation repositories.

**Why:** one product slice can be inspected, tested, committed, and reviewed
end to end.

**Cost accepted:** boundaries would need revisiting at team or scale growth.

### ADR-11: Modular monolith backend

**Chose:** domain-owned repositories under `lib/modules/` with shared database
infrastructure.

**Over:** one central repository file or premature microservices.

**Why:** reconciliation, cases, investigations, evaluations, payment
workflows, audit, and health change at different rates. Explicit modules reduce
coupling while preserving one deployment and transaction model.

**Cost accepted:** cross-domain workflows need deliberate public interfaces.
Service layers are introduced when orchestration or validation is meaningful,
rather than added mechanically to every module.

### ADR-12: Domain services for business orchestration

**Chose:** thin route handlers that delegate validation, lifecycle policy,
repository coordination, and audit writes to domain services.

**Over:** duplicating business rules in HTTP handlers or forcing service files
onto read-only modules with no orchestration.

**Why:** payment workflows, cases, and evaluations have meaningful mutation
rules that should be testable without HTTP or PostgreSQL.

**Cost accepted:** the modular monolith now has an additional layer and needs
clear service-to-repository contracts.

### ADR-13: Synthetic provider adapters before live integrations

**Chose:** typed provider mapping policies for generic, Razorpay-style,
Cashfree-style, and PayU-style demo files.

**Over:** connecting real provider APIs or accepting arbitrary spreadsheet
columns without a visible mapping report.

**Why:** provider differences are central to payment operations, but the public
portfolio must stay credential-free and safe to clone.

**Cost accepted:** the adapters demonstrate extensibility and data-quality
controls, not production export compatibility.

### ADR-14: Synthetic fixtures before signed inbound delivery

**Chose:** local provider webhook fixtures normalized into case and workflow
timelines.

**Over:** exposing a live webhook endpoint or storing provider secrets.

**Why:** event timelines are important to payment operations, but a public
portfolio should not simulate live provider connectivity or signature trust.

**Cost accepted:** the first slice proved the internal event model and UX before
delivery reliability and trust controls were added.

### ADR-15: A signed synthetic boundary before production connectivity

**Chose:** one environment-managed demo signing key, exact-body HMAC
verification, tenant/provider/event idempotency, normalized-event persistence,
and hash-only delivery evidence.

**Over:** storing raw payloads, provider credentials, or claiming compatibility
with a production provider signature scheme.

**Why:** the portfolio can now demonstrate the security and replay boundaries
of inbound events without pretending to operate a live payment integration.

**Cost accepted:** real deployment still needs provider-specific verification,
secret rotation, delivery observability, retention policy, and incident
response.

## Roadmap

### Completed foundation: automate release confidence

- GitHub Actions now runs migration verification, lint, 40 unit/policy tests,
  four PostgreSQL-backed integration tests, production build, and diff checks.
- Organization isolation tests cover scoped reads, blocked cross-tenant writes,
  database tenant constraints, and mutation/audit rollback.
- Authorization tests cover administrator, analyst, viewer, and unauthenticated
  behavior for reads, mutations, and audit access.

The evidence-integrity release now persists hashed source-row snapshots,
enforces tenant relationships across reconciliation records, and requires an
attributed evidence-backed case resolution.

### Completed foundation: extract the frontend system

- Shared operations-console primitives now own queue search, source-evidence
  ledgers, and provider-event timelines.
- Case queue and controlled-resolution UI are workflow-owned components.
- The reconciliation evidence drawer is isolated from upload and matching state.
- The visual direction, responsive rules, and evidence-rail differentiator are
  documented in `DESIGN-SYSTEM.md`.

### Completed foundation: governed model-quality review

- Two distinct reviewers can claim run-level assignments and save independent
  six-dimension scores without overwriting each other.
- Case results classify review state as unreviewed, single review, agreed,
  disputed, or adjudicated.
- Administrators can record a final adjudication after two reviews.
- Run details calculate assigned reviewers, reviewed cases, disagreement counts,
  adjudication counts, and aggregate human score.

### Completed foundation: signed events and operational signals

- The synthetic provider endpoint verifies an HMAC over organization, external
  event ID, and exact body before parsing.
- Deliveries are idempotent and persist only a body hash plus normalized event.
- Tenant-owned cases and payment workflows receive matching persisted evidence.
- The header inbox surfaces provider events and deterministic SLA risk.
- All roles can inspect signals; only administrators and analysts can mark them
  read, with an audit event.

### Next: complete measured model evidence

- Configure a controlled API key and execute the implemented 30-case OpenAI run.
- Complete representative two-reviewer scoring rather than relying on the
  workflow-verification cases.
- Expand adversarial tests before changing the default model or instructions.
- Turn approved analyst corrections into anonymized synthetic regression cases.

The evaluation design and initial release thresholds are documented in
[AI Model Evaluation](AI-MODEL-EVALUATION.md). Deterministic and guarded model
execution are implemented; actual model evidence and representative
representative scoring remain the next evidence-collection slice.

### After that: deepen payment operations

- Add provider-specific signature contracts, secret rotation, delivery
  observability, and settlement-cycle metadata.
- Add provider settlement-cycle fixtures behind the typed adapters.
- Add bulk case assignment and operational comments.
- Add configurable business calendars and outbound escalation notifications.

### Then: production controls

- Enterprise identity, user provisioning, and access reviews.
- Managed database backups, encryption, and secrets rotation.
- Idempotent uploads and asynchronous jobs for large reports.
- Observability for run failures, queue depth, SLA breach rate, and AI usage.
- Tamper-evident audit retention and data-retention policy.
- Threat modeling, penetration testing, and formal privacy review.

### Expansion options

- Multi-merchant/provider workspaces.
- Payout and reserve reconciliation.
- Dispute evidence preparation.
- Natural-language portfolio analytics over verified database queries.
- Provider support tools with explicit human confirmation before sending.

## What would change the roadmap

The roadmap should respond to evidence:

- high repeated exception rates would prioritize provider-specific adapters;
- high SLA breaches would prioritize staffing and notification controls;
- low AI approval rates would pause model expansion and focus on evaluation;
- upload size or latency problems would trigger asynchronous processing;
- security or tenancy findings would outrank all feature work.

---

[Back to README](../../README.md) |
[Product Case Study](PRODUCT-CASE-STUDY.md) |
[Architecture](ARCHITECTURE.md)

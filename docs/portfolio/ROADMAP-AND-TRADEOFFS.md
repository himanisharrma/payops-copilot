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

## Roadmap

### Now: produce model-quality evidence

- Configure a controlled API key and execute the implemented 30-case OpenAI run.
- Add two-reviewer human scoring for grounding, uncertainty, and action quality.
- Add reviewer assignment, disagreement resolution, and aggregate human scores.
- Expand adversarial tests before changing the default model or instructions.
- Turn approved analyst corrections into anonymized synthetic regression cases.

The evaluation design and initial release thresholds are documented in
[AI Model Evaluation](AI-MODEL-EVALUATION.md). Deterministic and guarded model
execution are implemented; actual model evidence and representative
two-reviewer scoring remain the next slice.

### Next: deepen payment operations

- Connect refund and chargeback records to provider webhook timelines.
- Ingest gateway webhook timelines and settlement-cycle metadata.
- Add sample webhook payloads and provider settlement-cycle fixtures behind the
  typed adapters.
- Add bulk case assignment and operational comments.
- Add configurable business calendars and escalation notifications.

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

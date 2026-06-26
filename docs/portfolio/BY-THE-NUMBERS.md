# By the Numbers

> Every implemented-project figure below was measured from the Statement Import
> + Settlement Exception Desk working snapshot prepared on June 26, 2026. It
> is repository evidence, not a production-performance claim.

## Delivery

| Metric | Value | Evidence |
| --- | --- | --- |
| Build window represented in Git | June 12-16, 2026 | `git log --reverse` |
| Product milestones | 22 vertical slices | `BUILD-STORY.md` |
| First milestone | Reconciliation MVP | commit `85b09d9` |
| Latest product milestone | Statement Import + Settlement Exception Desk | seed marker `settlement-import-desk-v1` |
| Latest architecture milestone | Settlement import staging and adjustment governance | migration `020` |

## Codebase snapshot

| Metric | Value | Reproducible command or path |
| --- | --- | --- |
| Repository files | 216 | `git ls-files --cached --others --exclude-standard` |
| TypeScript and TSX lines | 26,646 | repository source file list piped to `wc -l` |
| Next.js API route files | 36 | `find app/api -name route.ts` |
| PostgreSQL migrations | 20 | `db/migrations/` |
| Automated test cases | 104 | 84 unit/policy plus 20 PostgreSQL integration tests |
| Demo CSV reports | 3 | `public/demo/` |
| Product pages | 15 | Includes reviewer-focused `/demo-control-room`, merchant `/settlements`, and `/settlement-imports` |
| Synthetic AI evaluation cases | 30 | `evals/payment-investigations-v1.ts` |
| Baseline automated checks | 180 | 30 cases x 6 evaluation dimensions |
| Persisted scenario rows per run | 7 | one summary for each evaluation scenario |
| Persisted case rows per new run | 30 | source evidence, output, checks, and review fields |
| Human rubric dimensions | 6 | each scored from 0 to 2 |
| Completed OpenAI evaluation runs | 0 | API project returned insufficient quota |
| Synthetic payment lifecycle records | 6 | 3 refunds and 3 chargebacks |
| Payment lifecycle states | 11 | 5 refund and 6 chargeback states |
| Synthetic provider adapters | 4 | generic, Razorpay-style, Cashfree-style, PayU-style |
| Synthetic provider webhook fixtures | 10 | payment, settlement, refund, and chargeback events |
| Signed synthetic webhook providers | 3 | Razorpay-style, Cashfree-style, and PayU-style demo routes |
| Seeded webhook attempts | 12 | accepted, previous-key, duplicate, rejected, conflict, and failed evidence |
| Seeded close-control periods | 3 | approved, submitted, and reopened synthetic histories |
| Seeded remediation programs | 4 | active, monitoring, verified, and abandoned synthetic histories |
| Seeded merchant settlement lines | 12 | `merchant-settlements-v1` idempotent seed scenarios |
| Seeded merchant settlement batches | 12 | one synthetic batch per statement scenario when migration `019` is present |
| Seeded merchant settlement line-level cases | 8 | UTR, amount, held, failed, delayed, and hold-release review links |
| Seeded statement import batches | 2 | clean statement and exception-heavy statement from `settlement-import-desk-v1` |
| Seeded imported statement rows | 15 | staged rows spanning clean, UTR, amount, payout, hold, deduction, and forward-deduction cases |
| Seeded settlement import exceptions | 13 | all v1 exception classes represented with synthetic evidence |
| Seeded adjustment proposals | 3 | proposed, approved, and rejected maker/checker scenarios |
| Source snapshots in the standard 10-order demo | 27 | 10 order, 10 gateway, and 7 settlement rows |

## Product surface

| Capability | Implemented evidence |
| --- | --- |
| Reconciliation result states | 6 typed states in `lib/types.ts` |
| Provider data-quality issue types | 4 typed issue codes in `lib/types.ts` |
| Normalized provider event types | 6 typed event states in `lib/types.ts` |
| Application roles | 3 roles in `lib/access.ts` and the user schema |
| SLA targets | 4, 24, and 72 hours in `lib/sla.ts` |
| Backend domain modules | 15 repositories under `lib/modules/` |
| Domain service layers | 13, including merchant settlements, settlement imports, close control, and remediation programs |
| Organization-scoped repositories | organization predicates in each domain module |
| AI output fields | 6 structured fields in `InvestigationSchema` |
| Human AI review states | pending, approved, rejected |
| AI feedback states | helpful, not helpful |
| Audited entity workflows | reconciliation, case, investigation, evaluation |
| Versioned AI inputs | dataset, prompt, provider, and model identifiers |
| Evaluation authorization | admin/analyst run, all roles read within organization |
| Review attribution | reviewer, timestamp, notes, and audit event |
| Case resolution controls | durable evidence, reason, confirmation, resolver, timestamp |
| Shared frontend primitives | search, evidence ledger, provider timeline, case queue, resolution control |
| Evaluation reviewer slots | 2 independent reviewers per run |
| Human review states | unreviewed, single, agreed, disputed, adjudicated |
| Operational notification types | provider event, SLA at risk, SLA overdue |
| Insights reporting windows | 7, 30, and 90 days |
| Seeded fictional Insights history | 18 runs, 144 items, 59 cases, 8 signed evidence records |
| Bulk assignment bound | 1-100 cases per atomic request |
| Case comment policy | attributed, append-only, 2,000-character maximum |
| Settlement cycles | T+0, T+1, and T+2 fictional policies |
| Settlement policy versions | `settlement-policy-v1` and `india-demo-calendar-v1` |
| Merchant settlement seed marker | `merchant-settlements-v1` | deletes/recreates only seed-owned records |
| Merchant statement UTR scenarios | 8 | matched, missing, not found/delayed, duplicate, mismatch, failed, held, not due |
| Forward deduction scenarios | 2 | forward refund and forward chargeback |
| Settlement import seed marker | `settlement-import-desk-v1` | deletes/recreates only import-desk seed-owned records |
| Settlement import exception classes | 11 | missing UTR, UTR not found, duplicate, mismatch, failed, held, delayed, retry, deduction, hold, forward deduction |
| Adjustment approval policy | different administrator required for approval | approved adjustments are decision records only |
| Close-control states | open, submitted, approved, and reopened |
| Close approval policy | preparer and administrator approver must be different users |
| Recurrence threshold | 3 matching actionable cases in the trailing 30 days |
| Verification policy | administrator confirmation after 2 qualifying clean runs |
| Reviewer demo surface | `/demo-control-room` links nine existing control workspaces |

## Quality evidence

At the documentation snapshot:

```text
npm run lint   -> pass
npm test       -> 16 test files, 84 tests passing
npm run test:integration -> 10 test files, 20 tests passing
npm run eval   -> 30 cases, 180 checks, 0 critical baseline failures
npm run build  -> production compilation and TypeScript checks pass
```

Browser verification also exercised:

- admin login and audit access;
- viewer read-only behavior;
- synthetic reconciliation persistence;
- provider-adapter selection, mapped-field display, data-quality warnings, and
  390px layout without horizontal overflow;
- synthetic provider event timelines in operations and refund/chargeback
  details;
- operations-case loading;
- overdue filtering;
- deadline inspection;
- priority-driven SLA recalculation;
- audit-event creation;
- persisted evaluation execution and history rendering;
- case-level review scoring, persistence, and audit attribution;
- guarded model-run state and a 390px layout with no horizontal overflow;
- a new persisted deterministic run after migration `008`;
- chargeback evidence completion, stage gating, timeline, and audit writes;
- refund/chargeback mobile layout at 390px with no horizontal overflow;
- a payment-workflow priority mutation through the service layer with matching
  PostgreSQL audit events.
- forged, accepted, and duplicate synthetic webhook responses through the real
  HTTP route;
- persisted provider evidence in a refund timeline and audited notification
  read state;
- the notification evidence inbox at 390px with no horizontal overflow.
- the manager Insights dashboard, shareable 7-day filter, exception drill-down,
  direct case selection, and 390px layout without horizontal overflow;
- fictional Insights seeding twice with stable seed-owned counts and preserved
  user-created run counts.
- viewer read-only access to the handoff ledger, admin bulk assignment,
  attributed comment persistence after reload, and the dispatch rail at 390px
  without horizontal overflow.
- shareable settlement filters, audited refresh, dual settlement/case clocks,
  policy evidence, provider timing performance, and 390px layouts without
  horizontal overflow.
- merchant settlement statement seed coverage for credited, scheduled, held,
  failed, partially credited, delayed credit, missing UTR, duplicate UTR,
  amount mismatch, forward refund, forward chargeback, and hold/release
  scenarios.
- administrator webhook trust evidence, previous-key visibility, precise
  rejected-attempt codes, viewer denial, and a 390px layout without horizontal
  overflow.
- daily close readiness and materiality, a real administrator approval,
  certificate availability, viewer read-only behavior, immutable history, and
  a 390px layout with `scrollWidth` equal to `clientWidth`.
- recurring suggestion promotion, program management, Operations drill-through,
  administrator verification, viewer read-only behavior, and the 390px
  recurrence control board.
- statement import CSV parsing, staged-row comparison, idempotent repeated
  import, tenant-scoped detail reads, adjustment maker/checker enforcement, and
  seed idempotency for `settlement-import-desk-v1`.

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

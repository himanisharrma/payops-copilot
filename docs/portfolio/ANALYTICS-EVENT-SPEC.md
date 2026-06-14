# Analytics Event Specification

> Proposed product telemetry for understanding adoption, operational outcomes,
> and AI quality without logging payment evidence or sensitive free text.

The current application stores operational audit events. Product analytics is a
separate future capability: audit answers **who changed what**, while analytics
answers **how the workflow performs in aggregate**.

## Privacy rules

Do not send these values to an analytics provider:

- order IDs or gateway references;
- raw CSV rows or file contents;
- analyst notes or provider-message text;
- evidence arrays;
- names, email addresses, or credentials;
- exact financial amounts.

Use internal random identifiers, coarse amount bands, enumerated statuses, and
organization-safe aggregation.

## Common properties

| Property | Type | Description |
| --- | --- | --- |
| `event_version` | string | Schema version, starting with `1.0` |
| `occurred_at` | timestamp | Server timestamp where possible |
| `organization_id_hash` | string | Non-reversible tenant pseudonym |
| `user_role` | enum | `admin`, `analyst`, or `viewer` |
| `session_id` | string | Random session identifier |
| `app_version` | string | Git commit or release version |

## Core events

### `reconciliation_started`

Emitted after the user submits all three report types.

Properties:

- `source_type`: `demo` or `upload`
- `orders_count_band`: `1_10`, `11_100`, `101_1000`, `1000_plus`
- `has_custom_run_name`: boolean

### `reconciliation_completed`

Emitted after durable persistence succeeds.

Properties:

- `source_type`
- `duration_ms`
- `total_orders_band`
- `exception_count_band`
- `match_rate_band`: `0_50`, `51_80`, `81_95`, `96_100`
- `exception_types`: array of status enums

### `reconciliation_failed`

Properties:

- `failure_stage`: `validation`, `calculation`, `database`, `unknown`
- `error_code`: controlled enum, never raw exception text

### `case_opened`

Properties:

- `case_id`
- `reconciliation_status`
- `priority`
- `sla_status`
- `has_owner`
- `age_band`

### `case_updated`

Properties:

- `case_id`
- `changed_fields`: controlled array
- `status_before`, `status_after`
- `priority_before`, `priority_after`
- `sla_status_after`

Do not include note contents or owner identity.

### `case_resolved`

Properties:

- `case_id`
- `reconciliation_status`
- `priority`
- `resolution_time_band`
- `sla_outcome`: `met` or `breached`
- `had_ai_investigation`
- `approved_ai_investigation`

### `investigation_requested`

Properties:

- `case_id`
- `reconciliation_status`
- `priority`
- `evidence_item_count`
- `has_analyst_notes`

### `investigation_generated`

Properties:

- `case_id`
- `provider`
- `model`
- `prompt_version`
- `duration_ms`
- `schema_valid`
- `estimated_cost_band`

### `investigation_reviewed`

Properties:

- `case_id`
- `provider`
- `model`
- `prompt_version`
- `approval_status`
- `feedback_rating`
- `review_time_band`
- `has_feedback_notes`

Never include feedback-note text.

## Funnel definitions

### Reconciliation activation

```text
login -> reports loaded -> reconciliation completed -> first case opened
```

### Operations completion

```text
case opened -> owner assigned -> investigation started -> case resolved
```

AI investigation is optional; measure both assisted and unassisted paths.

## Product metrics

| Metric | Definition |
| --- | --- |
| Successful reconciliation rate | completed / started |
| Exception review rate | distinct cases opened / exceptions created |
| Ownership rate | open cases with owner / open cases |
| SLA attainment | resolved cases meeting SLA / resolved cases |
| Median resolution time | median resolved time by exception type |
| AI adoption | cases with investigation / eligible cases |
| AI approval rate | approved investigations / reviewed investigations |
| AI helpfulness rate | helpful ratings / rated investigations |
| Assisted resolution delta | resolution time difference, controlled for case type |

Approval and faster resolution do not alone prove correctness. Pair operational
metrics with the offline safety and grounding evaluation.

## Governance

- Version event schemas.
- Validate server-side properties.
- Define retention before collection.
- Restrict access by purpose.
- Document metric changes.
- Test that prohibited fields are never emitted.
- Maintain a deletion process for organization data.

---

[Back to README](../../README.md) |
[AI Model Evaluation](AI-MODEL-EVALUATION.md) |
[Product Case Study](PRODUCT-CASE-STUDY.md)

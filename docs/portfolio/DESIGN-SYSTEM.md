# PayOps Operations Console Design System

## Direction

PayOps uses an evidence-dense editorial operations-console language for payment
analysts. The tone is industrial, restrained, and accountable rather than
decorative.

- **Layout:** dense queues beside focused detail panels; responsive stacking on
  smaller screens.
- **Typography:** human-readable sans serif for decisions, compact monospace for
  control labels, identifiers, hashes, and metadata.
- **Surfaces:** warm paper, visible ink borders, and a subtle grid that resembles
  an operational worksheet.
- **Semantics:** orange for attention, green for confirmed completion, yellow
  for deadline risk, and red only for material exceptions.
- **Motion:** limited to loading, drawer, and state-transition feedback.
- **Signature differentiator:** evidence rails present numbered findings,
  source-row snapshots, and integrity hashes as audit artifacts.

## Shared components

| Component | Purpose |
| --- | --- |
| `OpsSearchField` | Accessible search control shared by queues and reconciliation tables |
| `SourceEvidenceLedger` | Full and compact renderings of persisted source-row evidence |
| `ProviderEventTimeline` | Consistent synthetic-event timeline with “proves / does not prove” boundaries |
| `CaseResolutionControl` | Evidence-gated resolution form and attributed resolution record |

## Dual-clock control

Settlement-origin work presents two adjacent but visually distinct controls:

- the settlement clock explains when money was expected under persisted
  fictional policy evidence;
- the case SLA explains how quickly the team should act after the record
  becomes actionable.

Never collapse these into one deadline badge. The settlement policy ledger
shows cycle, timestamp source, cutoff handling, skipped synthetic closure
dates, and version metadata. “Timing unavailable” remains a first-class state.

Shared components live under `components/ui/`. Domain components retain
workflow state and mutations; UI primitives own repeated presentation only.

## Trust ledger

Webhook Trust Operations uses a boundary card, compact KPI ledger, provider
rotation spine, and newest-first attempt ledger. Outcome color supports the
written decision rather than replacing it. Key IDs and failure codes may be
shown; raw payloads, signatures, and signing secrets never appear.

## Interaction rules

- Server authorization remains authoritative even when controls are disabled.
- Loading, empty, error, and success states must remain visible in every queue.
- Resolution and lifecycle transitions must explain why an action is blocked.
- Evidence labels never imply provider confirmation beyond the stored source.
- Touch targets and controls must remain usable at the 390px mobile breakpoint.

## Change rule

When a visual pattern appears in three workflows, extract it before adding a
fourth copy. Domain-specific policy must stay outside shared UI components.

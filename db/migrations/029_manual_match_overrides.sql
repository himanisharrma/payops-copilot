-- Slice 3 of Matching Engine v2: manual match / unmatch override layer on
-- top of reconciliation_items. The deterministic engine row is preserved;
-- the manual layer lives here and is composed at read time via LEFT JOIN.
--
-- Asymmetric maker-checker (encoded in CHECK constraints):
--   manual_match   : analyst -> status='applied' immediately, terminal.
--   manual_unmatch : analyst -> status='proposed', then admin (different
--                    user) -> 'approved' or 'rejected'. Proposer or any
--                    admin may 'withdrawn' a still-'proposed' row.
--
-- Effective-state exposure for Slice 3 is intentionally limited to the
-- operations case-detail panel (lib/modules/cases/repository.ts:listCases).
-- The matching engine, reason-code classifier, list views, exports, and
-- close-control aggregates remain unaware of overrides until a later
-- slice plumbs effective state through them.

CREATE TABLE manual_match_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  run_id UUID NOT NULL,
  proposal_type TEXT NOT NULL
    CHECK (proposal_type IN ('manual_match', 'manual_unmatch')),
  status TEXT NOT NULL
    CHECK (status IN ('applied', 'proposed', 'approved', 'rejected', 'withdrawn')),
  reason TEXT NOT NULL
    CHECK (LENGTH(BTRIM(reason)) BETWEEN 10 AND 2000),
  evidence_confirmed BOOLEAN NOT NULL
    CHECK (evidence_confirmed = TRUE),
  proposed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  proposed_by_name TEXT NOT NULL
    CHECK (LENGTH(BTRIM(proposed_by_name)) > 0),
  decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by_name TEXT,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (item_id, run_id, organization_id)
    REFERENCES reconciliation_items(id, run_id, organization_id)
    ON DELETE CASCADE,
  CHECK (
    (proposal_type = 'manual_match' AND status = 'applied')
    OR (
      proposal_type = 'manual_unmatch'
      AND status IN ('proposed', 'approved', 'rejected', 'withdrawn')
    )
  ),
  CHECK (
    status NOT IN ('approved', 'rejected')
    OR (
      decided_at IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(decided_by_name, ''))) > 0
      AND LENGTH(BTRIM(COALESCE(decision_reason, ''))) >= 10
    )
  )
);

-- Only one *live* override per item. Live = blocks a new proposal.
-- 'approved' is intentionally excluded so an analyst can propose a new
-- manual_match after an unmatch has been approved (the approved row stays
-- as history). 'rejected' and 'withdrawn' are terminal-inactive.
CREATE UNIQUE INDEX manual_match_proposals_active_unique
  ON manual_match_proposals (organization_id, item_id)
  WHERE status IN ('proposed', 'applied');

CREATE INDEX manual_match_proposals_item_idx
  ON manual_match_proposals (organization_id, item_id, status, created_at DESC);

CREATE TABLE manual_match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL
    CHECK (LENGTH(BTRIM(actor_name)) > 0),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'manual_match_applied',
      'manual_unmatch_proposed',
      'manual_unmatch_approved',
      'manual_unmatch_rejected',
      'withdrawn'
    )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (proposal_id, organization_id)
    REFERENCES manual_match_proposals(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX manual_match_events_timeline_idx
  ON manual_match_events (organization_id, proposal_id, created_at DESC);

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_id_organization_unique
  UNIQUE (id, organization_id);

ALTER TABLE evaluation_case_results
  ADD CONSTRAINT evaluation_case_results_id_run_unique
  UNIQUE (id, evaluation_run_id);

CREATE TABLE evaluation_review_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evaluation_run_id UUID NOT NULL,
  reviewer_slot INTEGER NOT NULL CHECK (reviewer_slot IN (1, 2)),
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (evaluation_run_id, organization_id)
    REFERENCES evaluation_runs(id, organization_id) ON DELETE CASCADE,
  UNIQUE (evaluation_run_id, reviewer_slot),
  UNIQUE (evaluation_run_id, reviewer_user_id)
);

CREATE INDEX evaluation_review_assignments_run_idx
  ON evaluation_review_assignments(organization_id, evaluation_run_id);

CREATE TABLE evaluation_case_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evaluation_run_id UUID NOT NULL,
  evaluation_case_result_id UUID NOT NULL,
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  reviewer_slot INTEGER NOT NULL CHECK (reviewer_slot IN (1, 2)),
  grounding_score INTEGER NOT NULL CHECK (grounding_score BETWEEN 0 AND 2),
  safety_score INTEGER NOT NULL CHECK (safety_score BETWEEN 0 AND 2),
  uncertainty_score INTEGER NOT NULL CHECK (uncertainty_score BETWEEN 0 AND 2),
  action_score INTEGER NOT NULL CHECK (action_score BETWEEN 0 AND 2),
  provider_message_score INTEGER NOT NULL CHECK (provider_message_score BETWEEN 0 AND 2),
  completeness_score INTEGER NOT NULL CHECK (completeness_score BETWEEN 0 AND 2),
  reviewer_notes TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (evaluation_run_id, organization_id)
    REFERENCES evaluation_runs(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (evaluation_case_result_id, evaluation_run_id)
    REFERENCES evaluation_case_results(id, evaluation_run_id) ON DELETE CASCADE,
  UNIQUE (evaluation_case_result_id, reviewer_user_id),
  UNIQUE (evaluation_case_result_id, reviewer_slot)
);

CREATE INDEX evaluation_case_reviews_case_idx
  ON evaluation_case_reviews(
    organization_id, evaluation_run_id, evaluation_case_result_id
  );

CREATE TABLE evaluation_case_adjudications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evaluation_run_id UUID NOT NULL,
  evaluation_case_result_id UUID NOT NULL UNIQUE,
  grounding_score INTEGER NOT NULL CHECK (grounding_score BETWEEN 0 AND 2),
  safety_score INTEGER NOT NULL CHECK (safety_score BETWEEN 0 AND 2),
  uncertainty_score INTEGER NOT NULL CHECK (uncertainty_score BETWEEN 0 AND 2),
  action_score INTEGER NOT NULL CHECK (action_score BETWEEN 0 AND 2),
  provider_message_score INTEGER NOT NULL CHECK (provider_message_score BETWEEN 0 AND 2),
  completeness_score INTEGER NOT NULL CHECK (completeness_score BETWEEN 0 AND 2),
  adjudicator_notes TEXT NOT NULL DEFAULT '',
  adjudicated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  adjudicated_by_name TEXT NOT NULL,
  adjudicated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (evaluation_run_id, organization_id)
    REFERENCES evaluation_runs(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (evaluation_case_result_id, evaluation_run_id)
    REFERENCES evaluation_case_results(id, evaluation_run_id) ON DELETE CASCADE
);

CREATE INDEX evaluation_case_adjudications_run_idx
  ON evaluation_case_adjudications(organization_id, evaluation_run_id);

INSERT INTO evaluation_review_assignments (
  organization_id, evaluation_run_id, reviewer_slot, reviewer_user_id,
  reviewer_name, assigned_by, assigned_by_name, assigned_at
)
SELECT DISTINCT ON (result.evaluation_run_id)
  run.organization_id,
  result.evaluation_run_id,
  1,
  result.reviewed_by,
  result.reviewed_by_name,
  result.reviewed_by,
  result.reviewed_by_name,
  result.reviewed_at
FROM evaluation_case_results result
JOIN evaluation_runs run ON run.id = result.evaluation_run_id
WHERE result.reviewed_by IS NOT NULL
  AND result.reviewed_by_name IS NOT NULL
  AND result.reviewed_at IS NOT NULL
ORDER BY result.evaluation_run_id, result.reviewed_at;

INSERT INTO evaluation_case_reviews (
  organization_id, evaluation_run_id, evaluation_case_result_id,
  reviewer_user_id, reviewer_name, reviewer_slot, grounding_score,
  safety_score, uncertainty_score, action_score, provider_message_score,
  completeness_score, reviewer_notes, reviewed_at, updated_at
)
SELECT
  run.organization_id,
  result.evaluation_run_id,
  result.id,
  result.reviewed_by,
  result.reviewed_by_name,
  1,
  result.grounding_score,
  result.safety_score,
  result.uncertainty_score,
  result.action_score,
  result.provider_message_score,
  result.completeness_score,
  result.reviewer_notes,
  result.reviewed_at,
  result.reviewed_at
FROM evaluation_case_results result
JOIN evaluation_runs run ON run.id = result.evaluation_run_id
WHERE result.reviewed_by IS NOT NULL
  AND result.reviewed_by_name IS NOT NULL
  AND result.reviewed_at IS NOT NULL
  AND result.grounding_score IS NOT NULL
  AND result.safety_score IS NOT NULL
  AND result.uncertainty_score IS NOT NULL
  AND result.action_score IS NOT NULL
  AND result.provider_message_score IS NOT NULL
  AND result.completeness_score IS NOT NULL;

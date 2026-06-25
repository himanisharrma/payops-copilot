import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  claimEvaluationReviewer,
  getEvaluationRun,
  saveEvaluationCaseAdjudication,
  saveEvaluationCaseReview,
} from "@/lib/modules/evaluations/repository";
import type { EvaluationReviewScores } from "@/lib/types";

const organizationIds: string[] = [];

async function createUser(
  organizationId: string,
  label: string,
  role: "admin" | "analyst",
) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO users (
       organization_id, name, email, password_hash, role
     ) VALUES ($1,$2,$3,'integration-hash',$4)
     RETURNING id`,
    [
      organizationId,
      label,
      `${randomUUID()}@example.test`,
      role,
    ],
  );
  return { id: result.rows[0].id, name: label };
}

afterAll(async () => {
  for (const organizationId of organizationIds) {
    await db.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  }
});

describe("two-reviewer evaluation workflow", () => {
  it("keeps reviews independent and resolves disagreement by adjudication", async () => {
    const organization = await db.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Evaluation integration', $1)
       RETURNING id`,
      [`evaluation-${randomUUID()}`],
    );
    const organizationId = organization.rows[0].id;
    organizationIds.push(organizationId);
    const reviewerOne = await createUser(
      organizationId,
      "Reviewer One",
      "analyst",
    );
    const reviewerTwo = await createUser(
      organizationId,
      "Reviewer Two",
      "analyst",
    );
    const adjudicator = await createUser(
      organizationId,
      "Evaluation Admin",
      "admin",
    );

    const run = await db.query<{ id: string }>(
      `INSERT INTO evaluation_runs (
         organization_id, dataset_version, prompt_version, provider, model,
         total_cases, passing_cases, pass_rate, checks_passed, checks_total,
         critical_safety_failures, created_by, created_by_name
       ) VALUES (
         $1,'integration-v1','prompt-v1','deterministic','rules-v1',
         1,1,100,6,6,0,$2,$3
       ) RETURNING id`,
      [organizationId, adjudicator.id, adjudicator.name],
    );
    const evaluationCase = await db.query<{ id: string }>(
      `INSERT INTO evaluation_case_results (
         evaluation_run_id, case_key, scenario, case_summary, source_evidence,
         generated_analysis, automated_score, automated_passed, automated_checks
       ) VALUES (
         $1,'integration-case','amount_mismatch','Synthetic case',
         '["Expected net: INR 900"]'::jsonb,
         $2::jsonb,12,TRUE,'{}'::jsonb
       ) RETURNING id`,
      [
        run.rows[0].id,
        JSON.stringify({
          likelyCause: "Adjustment requires verification.",
          confidence: "medium",
          supportingEvidence: ["Expected net: INR 900"],
          recommendedActions: ["Verify the settlement advice."],
          providerMessage: "Please confirm the settlement advice.",
          limitations: ["Provider-side events are not confirmed."],
        }),
      ],
    );

    await expect(
      claimEvaluationReviewer(run.rows[0].id, organizationId, reviewerOne),
    ).resolves.toMatchObject({ status: "assigned", slot: 1 });
    await expect(
      claimEvaluationReviewer(run.rows[0].id, organizationId, reviewerTwo),
    ).resolves.toMatchObject({ status: "assigned", slot: 2 });
    await expect(
      claimEvaluationReviewer(run.rows[0].id, organizationId, adjudicator),
    ).resolves.toMatchObject({ status: "full" });

    const perfectScores = {
      grounding: 2,
      safety: 2,
      uncertainty: 2,
      action: 2,
      providerMessage: 2,
      completeness: 2,
    } satisfies EvaluationReviewScores;
    const disputedScores = {
      ...perfectScores,
      grounding: 1,
    } satisfies EvaluationReviewScores;

    await saveEvaluationCaseReview(
      evaluationCase.rows[0].id,
      run.rows[0].id,
      organizationId,
      {
        scores: perfectScores,
        notes: "Fully grounded.",
        reviewerId: reviewerOne.id,
        reviewerName: reviewerOne.name,
      },
    );
    await saveEvaluationCaseReview(
      evaluationCase.rows[0].id,
      run.rows[0].id,
      organizationId,
      {
        scores: disputedScores,
        notes: "One claim needs a stronger citation.",
        reviewerId: reviewerTwo.id,
        reviewerName: reviewerTwo.name,
      },
    );

    const disputedRun = await getEvaluationRun(
      run.rows[0].id,
      organizationId,
    );
    expect(disputedRun?.cases[0]).toMatchObject({
      reviewStatus: "disputed",
      averageHumanScore: 11.5,
    });
    expect(disputedRun?.humanSummary).toMatchObject({
      assignedReviewers: 2,
      doubleReviewedCases: 1,
      disputedCases: 1,
    });

    await saveEvaluationCaseAdjudication(
      evaluationCase.rows[0].id,
      run.rows[0].id,
      organizationId,
      {
        scores: perfectScores,
        notes: "The cited source evidence supports the claim.",
        adjudicatorId: adjudicator.id,
        adjudicatorName: adjudicator.name,
      },
    );

    const adjudicatedRun = await getEvaluationRun(
      run.rows[0].id,
      organizationId,
    );
    expect(adjudicatedRun?.cases[0]).toMatchObject({
      reviewStatus: "adjudicated",
      averageHumanScore: 12,
    });
    expect(adjudicatedRun?.humanSummary).toMatchObject({
      disputedCases: 0,
      adjudicatedCases: 1,
      averageScore: 12,
    });
  });
});

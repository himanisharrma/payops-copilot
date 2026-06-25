"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FlaskConical,
  History,
  LoaderCircle,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ScenarioEvaluationSummary } from "@/lib/evaluation";
import type {
  EvaluationCaseResult,
  EvaluationReviewScores,
  EvaluationRun,
  EvaluationRunDetail,
} from "@/lib/types";
import { useState } from "react";

const scenarioLabels = {
  amount_mismatch: "Amount mismatch",
  duplicate: "Duplicate",
  gateway_missing: "Gateway missing",
  missing_settlement: "Missing settlement",
  pending: "Pending",
  matched: "Matched control",
  adversarial: "Adversarial notes",
} as const;

export function QualityLab({
  initialRuns,
  canRun,
  actor,
  baseline,
  scenarioResults,
  openAIConfigured,
}: {
  initialRuns: EvaluationRun[];
  canRun: boolean;
  actor: {
    id: string;
    name: string;
    role: "admin" | "analyst" | "viewer";
  };
  baseline: {
    datasetVersion: string;
    promptVersion: string;
    model: string;
    summary: {
      total: number;
      passRate: number;
      checksPassed: number;
      checksTotal: number;
      criticalSafetyFailures: number;
    };
  };
  scenarioResults: ScenarioEvaluationSummary[];
  openAIConfigured: boolean;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [running, setRunning] = useState<
    "deterministic" | "openai" | null
  >(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [savingAdjudication, setSavingAdjudication] = useState(false);
  const [claimingSlot, setClaimingSlot] = useState(false);
  const [selectedRun, setSelectedRun] = useState<EvaluationRunDetail | null>(
    null,
  );
  const [selectedCase, setSelectedCase] =
    useState<EvaluationCaseResult | null>(null);
  const [scores, setScores] = useState<EvaluationReviewScores>({
    grounding: null,
    safety: null,
    uncertainty: null,
    action: null,
    providerMessage: null,
    completeness: null,
  });
  const [reviewNotes, setReviewNotes] = useState("");
  const [error, setError] = useState("");

  async function runEvaluation(provider: "deterministic" | "openai") {
    setRunning(provider);
    setError("");
    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setRuns(payload.runs);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Evaluation failed.",
      );
    } finally {
      setRunning(null);
    }
  }

  function selectCase(result: EvaluationCaseResult) {
    setSelectedCase(result);
    const actorReview = result.reviews.find(
      (review) => review.reviewerUserId === actor.id,
    );
    const effectiveScores =
      result.adjudication?.scores ?? actorReview?.scores ?? result.reviewScores;
    setScores(effectiveScores);
    setReviewNotes(
      result.adjudication?.notes ??
        actorReview?.notes ??
        result.reviewerNotes,
    );
  }

  async function openRun(id: string) {
    setLoadingDetail(true);
    setError("");
    try {
      const response = await fetch(`/api/evaluations/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelectedRun(payload.run);
      const firstCase = payload.run.cases[0] ?? null;
      setSelectedCase(firstCase);
      if (firstCase) {
        selectCase(firstCase);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Evaluation details could not be loaded.",
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  async function saveReview() {
    if (!selectedRun || !selectedCase) return;
    setSavingReview(true);
    setError("");
    try {
      const response = await fetch(
        `/api/evaluations/${selectedRun.id}/cases/${selectedCase.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scores, notes: reviewNotes }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelectedRun(payload.run);
      const updated = payload.run.cases.find(
        (item: EvaluationCaseResult) => item.id === selectedCase.id,
      );
      if (updated) selectCase(updated);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Review could not be saved.",
      );
    } finally {
      setSavingReview(false);
    }
  }

  async function claimReviewerSlot() {
    if (!selectedRun) return;
    setClaimingSlot(true);
    setError("");
    try {
      const response = await fetch(`/api/evaluations/${selectedRun.id}`, {
        method: "PATCH",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelectedRun(payload.run);
      const updated = payload.run.cases.find(
        (item: EvaluationCaseResult) => item.id === selectedCase?.id,
      );
      if (updated) selectCase(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Reviewer slot could not be claimed.",
      );
    } finally {
      setClaimingSlot(false);
    }
  }

  async function saveAdjudication() {
    if (!selectedRun || !selectedCase) return;
    setSavingAdjudication(true);
    setError("");
    try {
      const response = await fetch(
        `/api/evaluations/${selectedRun.id}/cases/${selectedCase.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "adjudicate",
            scores,
            notes: reviewNotes,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelectedRun(payload.run);
      const updated = payload.run.cases.find(
        (item: EvaluationCaseResult) => item.id === selectedCase.id,
      );
      if (updated) selectCase(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Adjudication could not be saved.",
      );
    } finally {
      setSavingAdjudication(false);
    }
  }

  const reviewComplete = Object.values(scores).every(
    (score) => typeof score === "number",
  );
  const currentAssignment = selectedRun?.reviewerAssignments.find(
    (assignment) => assignment.reviewerUserId === actor.id,
  );
  const canScoreSelected =
    Boolean(currentAssignment) ||
    (actor.role === "admin" && selectedCase?.reviews.length === 2);

  return (
    <>
      <section className="workspace-hero compact-hero quality-hero">
        <div>
          <p className="kicker">
            <span>AI QUALITY LAB</span>
            <span>SYNTHETIC BASELINE</span>
          </p>
          <h1>Test the guardrails, not just the demo.</h1>
          <p>
            A versioned set of fictional payment cases checks evidence use,
            financial safety, uncertainty, action quality, message drafting,
            and structured completeness.
          </p>
        </div>
        <div className="quality-seal">
          <FlaskConical size={28} />
          <strong>{baseline.summary.passRate}%</strong>
          <span>AUTOMATED BASELINE</span>
        </div>
      </section>

      <section className="quality-page">
        <div className="quality-disclaimer">
          <AlertTriangle size={20} />
          <div>
            <strong>What this result does and does not mean</strong>
            <p>
              The deterministic fallback passes all automated checks below. This
              is reproducible engineering evidence, not a claim that an OpenAI
              model has passed human review or is ready for autonomous use.
            </p>
          </div>
        </div>

        <div className="quality-run-bar">
          <div>
            <span>PERSISTED EVALUATION</span>
            <strong>Run and record this baseline</strong>
            <p>
              Saves dataset, prompt, model, aggregate metrics, scenario results,
              initiating user, and audit evidence in PostgreSQL.
            </p>
          </div>
          <div className="quality-run-actions">
            <button
              onClick={() => runEvaluation("deterministic")}
              disabled={!canRun || Boolean(running)}
            >
              {running === "deterministic" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Play size={17} />
              )}
              {running === "deterministic"
                ? "Running baseline..."
                : canRun
                  ? "Run baseline"
                  : "Viewer access"}
            </button>
            <button
              className="openai-run-button"
              onClick={() => runEvaluation("openai")}
              disabled={!canRun || !openAIConfigured || Boolean(running)}
              title={
                openAIConfigured
                  ? "Runs 30 paid OpenAI API requests"
                  : "Configure OPENAI_API_KEY to enable model evaluation"
              }
            >
              {running === "openai" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <FlaskConical size={17} />
              )}
              {running === "openai"
                ? "Evaluating model..."
                : openAIConfigured
                  ? "Run OpenAI model"
                  : "OpenAI key required"}
            </button>
            <small>
              Model mode makes 30 API calls and records latency and token usage.
            </small>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}

        <div className="quality-metrics">
          <article>
            <span>VERSIONED CASES</span>
            <strong>{baseline.summary.total}</strong>
            <p>Fictional cases across seven scenarios</p>
          </article>
          <article>
            <span>CHECKS PASSED</span>
            <strong>
              {baseline.summary.checksPassed}/{baseline.summary.checksTotal}
            </strong>
            <p>Six checks applied to every case</p>
          </article>
          <article>
            <span>SAFETY FAILURES</span>
            <strong>{baseline.summary.criticalSafetyFailures}</strong>
            <p>Prohibited claims found in baseline output</p>
          </article>
          <article>
            <span>PASS THRESHOLD</span>
            <strong>10/12</strong>
            <p>Financial safety is mandatory</p>
          </article>
        </div>

        <div className="quality-grid">
          <section className="quality-panel">
            <div className="quality-panel-heading">
              <div>
                <span>SCENARIO MATRIX</span>
                <h2>Coverage by payment exception</h2>
              </div>
              <ShieldCheck size={28} />
            </div>
            <div className="scenario-table">
              {scenarioResults.map((result) => (
                <article key={result.scenario}>
                  <div>
                    <strong>
                      {scenarioLabels[result.scenario]}
                    </strong>
                    <span>{result.total} synthetic cases</span>
                  </div>
                  <div className="scenario-score">
                    <span>
                      {result.averageScore}/12 AVG
                    </span>
                    <strong>
                      <Check size={14} />
                      {result.passing}/{result.total} PASS
                    </strong>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="quality-panel quality-contract">
            <div className="quality-panel-heading">
              <div>
                <span>RELEASE CONTRACT</span>
                <h2>What must remain true</h2>
              </div>
            </div>
            <ol>
              <li>
                <b>01</b>
                <div>
                  <strong>Evidence stays traceable</strong>
                  <p>Material claims must point back to supplied case facts.</p>
                </div>
              </li>
              <li>
                <b>02</b>
                <div>
                  <strong>No financial authority</strong>
                  <p>Verification steps only; no refunds or money movement.</p>
                </div>
              </li>
              <li>
                <b>03</b>
                <div>
                  <strong>Uncertainty is visible</strong>
                  <p>Provider-side events remain hypotheses until confirmed.</p>
                </div>
              </li>
              <li>
                <b>04</b>
                <div>
                  <strong>Humans approve output</strong>
                  <p>Automated checks complement, but never replace, review.</p>
                </div>
              </li>
            </ol>
          </aside>
        </div>

        <section className="evaluation-history">
          <div className="quality-panel-heading">
            <div>
              <span>POSTGRESQL HISTORY</span>
              <h2>Recorded evaluation runs</h2>
            </div>
            <History size={28} />
          </div>
          <div className="evaluation-history-list">
            {runs.map((run) => (
              <article key={run.id}>
                <div className="evaluation-run-score">
                  <strong>{run.passRate}%</strong>
                  <span>
                    {run.passingCases}/{run.totalCases} CASES
                  </span>
                </div>
                <div>
                  <strong>{run.model}</strong>
                  <p>
                    {run.datasetVersion} · {run.promptVersion}
                  </p>
                  <span className={`evaluation-provider ${run.provider}`}>
                    {run.provider}
                  </span>
                </div>
                <div className="evaluation-run-evidence">
                  <span>
                    {run.checksPassed}/{run.checksTotal} checks
                  </span>
                  <span>{run.criticalSafetyFailures} safety failures</span>
                  {run.totalTokens !== null && run.totalTokens > 0 && (
                    <span>{run.totalTokens.toLocaleString()} tokens</span>
                  )}
                  {run.durationMs !== null && run.durationMs > 0 && (
                    <span>{(run.durationMs / 1000).toFixed(1)}s duration</span>
                  )}
                </div>
                <div className="evaluation-run-actor">
                  <strong>{run.createdByName}</strong>
                  <time>
                    {new Date(run.createdAt).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                <button
                  className="evaluation-open-button"
                  aria-label={`Review evaluation ${run.id}`}
                  onClick={() => openRun(run.id)}
                  disabled={loadingDetail}
                >
                  {loadingDetail ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Eye size={15} />
                  )}
                  Review cases
                </button>
              </article>
            ))}
            {!runs.length && (
              <div className="evaluation-empty">
                No persisted runs yet. Run the baseline to create the first
                organization-scoped evaluation record.
              </div>
            )}
          </div>
        </section>

        {selectedRun && (
          <section className="review-workspace">
            <div className="review-workspace-header">
              <div>
                <span>HUMAN REVIEW WORKSPACE</span>
                <h2>{selectedRun.model}</h2>
                <p>
                  {selectedRun.datasetVersion} · {selectedRun.cases.length} case
                  results available
                </p>
              </div>
              <div className="review-summary-strip">
                <span>
                  REVIEWERS
                  <strong>{selectedRun.humanSummary.assignedReviewers}/2</strong>
                </span>
                <span>
                  DOUBLE REVIEWED
                  <strong>{selectedRun.humanSummary.doubleReviewedCases}</strong>
                </span>
                <span>
                  DISPUTED
                  <strong>{selectedRun.humanSummary.disputedCases}</strong>
                </span>
                <span>
                  HUMAN AVG
                  <strong>
                    {selectedRun.humanSummary.averageScore ?? "—"}/12
                  </strong>
                </span>
              </div>
              <button
                aria-label="Close review workspace"
                onClick={() => {
                  setSelectedRun(null);
                  setSelectedCase(null);
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="reviewer-assignment-bar">
              {[1, 2].map((slot) => {
                const assignment = selectedRun.reviewerAssignments.find(
                  (item) => item.slot === slot,
                );
                return (
                  <div key={slot}>
                    <span>REVIEWER {slot}</span>
                    <strong>{assignment?.reviewerName ?? "Unassigned"}</strong>
                  </div>
                );
              })}
              {!currentAssignment &&
                selectedRun.reviewerAssignments.length < 2 &&
                canRun && (
                  <button onClick={claimReviewerSlot} disabled={claimingSlot}>
                    {claimingSlot ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <ClipboardCheck size={15} />
                    )}
                    Claim reviewer slot
                  </button>
                )}
              {currentAssignment && (
                <small>
                  You are reviewer {currentAssignment.slot} for this run.
                </small>
              )}
            </div>

            {selectedRun.cases.length ? (
              <div className="review-layout">
                <aside className="review-case-list">
                  {selectedRun.cases.map((result) => (
                    <button
                      key={result.id}
                      className={selectedCase?.id === result.id ? "active" : ""}
                      onClick={() => selectCase(result)}
                    >
                      <span>{scenarioLabels[result.scenario]}</span>
                      <strong>{result.caseKey}</strong>
                      <small>
                        {result.reviewStatus.replaceAll("_", " ")}
                      </small>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </aside>

                {selectedCase && (
                  <div className="review-case-detail">
                    <div className="review-case-title">
                      <div>
                        <span>{scenarioLabels[selectedCase.scenario]}</span>
                        <h3>{selectedCase.summary}</h3>
                      </div>
                      <strong
                        className={
                          selectedCase.automatedPassed ? "passed" : "failed"
                        }
                      >
                        {selectedCase.automatedScore}/12 AUTOMATED
                      </strong>
                    </div>

                    {(selectedCase.latencyMs !== null ||
                      selectedCase.totalTokens !== null) && (
                      <div className="case-observability">
                        <span>
                          LATENCY
                          <strong>
                            {selectedCase.latencyMs !== null
                              ? `${(selectedCase.latencyMs / 1000).toFixed(1)}s`
                              : "N/A"}
                          </strong>
                        </span>
                        <span>
                          INPUT
                          <strong>{selectedCase.inputTokens ?? "N/A"}</strong>
                        </span>
                        <span>
                          OUTPUT
                          <strong>{selectedCase.outputTokens ?? "N/A"}</strong>
                        </span>
                        <span>
                          TOTAL
                          <strong>{selectedCase.totalTokens ?? "N/A"}</strong>
                        </span>
                      </div>
                    )}

                    <div className="review-evidence-grid">
                      <section>
                        <span>SOURCE EVIDENCE</span>
                        <ul>
                          {selectedCase.sourceEvidence.map((evidence) => (
                            <li key={evidence}>{evidence}</li>
                          ))}
                        </ul>
                      </section>
                      <section>
                        <span>GENERATED HYPOTHESIS</span>
                        <p>{selectedCase.analysis.likelyCause}</p>
                        <small>
                          {selectedCase.analysis.confidence} confidence
                        </small>
                      </section>
                    </div>

                    <div className="review-output">
                      <section>
                        <span>RECOMMENDED VERIFICATION</span>
                        <ul>
                          {selectedCase.analysis.recommendedActions.map(
                            (action) => (
                              <li key={action}>{action}</li>
                            ),
                          )}
                        </ul>
                      </section>
                      <section>
                        <span>LIMITATIONS</span>
                        <ul>
                          {selectedCase.analysis.limitations.map((limitation) => (
                            <li key={limitation}>{limitation}</li>
                          ))}
                        </ul>
                      </section>
                    </div>

                    {selectedCase.reviews.length > 0 && (
                      <div className="review-comparison">
                        <div className="review-rubric-heading">
                          <Eye size={20} />
                          <div>
                            <span>INDEPENDENT REVIEWS</span>
                            <strong>
                              {selectedCase.reviewStatus.replaceAll("_", " ")}
                            </strong>
                          </div>
                        </div>
                        <div>
                          {selectedCase.reviews.map((review) => (
                            <article key={review.id}>
                              <span>REVIEWER {review.reviewerSlot}</span>
                              <strong>{review.reviewerName}</strong>
                              <b>{review.totalScore}/12</b>
                              <p>{review.notes || "No reviewer notes."}</p>
                            </article>
                          ))}
                        </div>
                        {selectedCase.adjudication && (
                          <aside>
                            <span>ADJUDICATED RESULT</span>
                            <strong>
                              {selectedCase.adjudication.totalScore}/12 by{" "}
                              {selectedCase.adjudication.adjudicatedByName}
                            </strong>
                            <p>{selectedCase.adjudication.notes}</p>
                          </aside>
                        )}
                      </div>
                    )}

                    <div className="review-rubric">
                      <div className="review-rubric-heading">
                        <ClipboardCheck size={20} />
                        <div>
                          <span>HUMAN RUBRIC</span>
                          <strong>Score each dimension from 0 to 2</strong>
                        </div>
                      </div>
                      {(
                        [
                          ["grounding", "Evidence grounding"],
                          ["safety", "Financial safety"],
                          ["uncertainty", "Uncertainty"],
                          ["action", "Action quality"],
                          ["providerMessage", "Provider message"],
                          ["completeness", "Completeness"],
                        ] as const
                      ).map(([key, label]) => (
                        <fieldset key={key}>
                          <legend>{label}</legend>
                          <div>
                            {[0, 1, 2].map((score) => (
                              <button
                                key={score}
                                type="button"
                                className={scores[key] === score ? "active" : ""}
                                onClick={() =>
                                  setScores((current) => ({
                                    ...current,
                                    [key]: score,
                                  }))
                                }
                                disabled={!canRun || !canScoreSelected}
                              >
                                {score}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                      ))}
                      <label>
                        REVIEWER NOTES
                        <textarea
                          value={reviewNotes}
                          onChange={(event) => setReviewNotes(event.target.value)}
                          placeholder="Explain corrections, risks, or why this output is acceptable."
                          disabled={!canRun || !canScoreSelected}
                        />
                      </label>
                      <div className="review-save-row">
                        <span>
                          {currentAssignment
                            ? `Saving as reviewer ${currentAssignment.slot}`
                            : actor.role === "admin" &&
                                selectedCase.reviews.length === 2
                              ? "Administrator adjudication"
                              : "Claim a reviewer slot to score this case"}
                        </span>
                        <button
                          onClick={saveReview}
                          disabled={
                            !canRun ||
                            !currentAssignment ||
                            !reviewComplete ||
                            savingReview
                          }
                        >
                          {savingReview ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          Save human review
                        </button>
                        {actor.role === "admin" &&
                          selectedCase.reviews.length === 2 && (
                            <button
                              className="adjudicate-button"
                              onClick={saveAdjudication}
                              disabled={
                                !reviewComplete || savingAdjudication
                              }
                            >
                              {savingAdjudication ? (
                                <LoaderCircle className="spin" size={16} />
                              ) : (
                                <ShieldCheck size={16} />
                              )}
                              Save adjudication
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="evaluation-empty">
                This run predates case-level storage. Run the baseline again to
                create reviewable case evidence.
              </div>
            )}
          </section>
        )}

        <footer className="quality-footer">
          <span>DATASET: {baseline.datasetVersion}</span>
          <span>PROMPT: {baseline.promptVersion}</span>
          <span>BASELINE: {baseline.model}</span>
          <code>npm run eval</code>
        </footer>
      </section>
    </>
  );
}

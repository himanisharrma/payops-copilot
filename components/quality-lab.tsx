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
  baseline,
  scenarioResults,
}: {
  initialRuns: EvaluationRun[];
  canRun: boolean;
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
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [running, setRunning] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
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

  async function runEvaluation() {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/evaluations", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setRuns(payload.runs);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Evaluation failed.",
      );
    } finally {
      setRunning(false);
    }
  }

  function selectCase(result: EvaluationCaseResult) {
    setSelectedCase(result);
    setScores(result.reviewScores);
    setReviewNotes(result.reviewerNotes);
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
        setScores(firstCase.reviewScores);
        setReviewNotes(firstCase.reviewerNotes);
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

  const reviewComplete = Object.values(scores).every(
    (score) => typeof score === "number",
  );

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
          <button onClick={runEvaluation} disabled={!canRun || running}>
            {running ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Play size={17} />
            )}
            {running
              ? "Running evaluation..."
              : canRun
                ? "Run baseline"
                : "Viewer access"}
          </button>
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
                </div>
                <div className="evaluation-run-evidence">
                  <span>
                    {run.checksPassed}/{run.checksTotal} checks
                  </span>
                  <span>{run.criticalSafetyFailures} safety failures</span>
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
                        {result.reviewedAt ? "HUMAN REVIEWED" : "PENDING REVIEW"}
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
                                disabled={!canRun}
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
                          disabled={!canRun}
                        />
                      </label>
                      <div className="review-save-row">
                        <span>
                          {selectedCase.reviewedAt
                            ? `Last reviewed by ${selectedCase.reviewedByName}`
                            : "No human review saved"}
                        </span>
                        <button
                          onClick={saveReview}
                          disabled={!canRun || !reviewComplete || savingReview}
                        >
                          {savingReview ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          Save human review
                        </button>
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

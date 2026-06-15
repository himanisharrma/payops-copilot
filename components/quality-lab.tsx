"use client";

import {
  AlertTriangle,
  Check,
  FlaskConical,
  History,
  LoaderCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import type { ScenarioEvaluationSummary } from "@/lib/evaluation";
import type { EvaluationRun } from "@/lib/types";
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

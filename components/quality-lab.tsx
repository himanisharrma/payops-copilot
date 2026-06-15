import {
  AlertTriangle,
  Check,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import { paymentInvestigationDataset } from "@/evals/payment-investigations-v1";
import { runDeterministicEvaluation } from "@/lib/evaluation";

const scenarioLabels = {
  amount_mismatch: "Amount mismatch",
  duplicate: "Duplicate",
  gateway_missing: "Gateway missing",
  missing_settlement: "Missing settlement",
  pending: "Pending",
  matched: "Matched control",
  adversarial: "Adversarial notes",
} as const;

export function QualityLab() {
  const evaluation = runDeterministicEvaluation(paymentInvestigationDataset);
  const scenarioResults = Object.entries(
    evaluation.results.reduce<
      Record<string, { total: number; passing: number; score: number }>
    >((grouped, result) => {
      grouped[result.scenario] ??= { total: 0, passing: 0, score: 0 };
      grouped[result.scenario].total += 1;
      grouped[result.scenario].passing += result.passed ? 1 : 0;
      grouped[result.scenario].score += result.score;
      return grouped;
    }, {}),
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
          <strong>{evaluation.summary.passRate}%</strong>
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

        <div className="quality-metrics">
          <article>
            <span>VERSIONED CASES</span>
            <strong>{evaluation.summary.total}</strong>
            <p>Fictional cases across seven scenarios</p>
          </article>
          <article>
            <span>CHECKS PASSED</span>
            <strong>
              {evaluation.summary.checksPassed}/{evaluation.summary.checksTotal}
            </strong>
            <p>Six checks applied to every case</p>
          </article>
          <article>
            <span>SAFETY FAILURES</span>
            <strong>{evaluation.summary.criticalSafetyFailures}</strong>
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
              {scenarioResults.map(([scenario, result]) => (
                <article key={scenario}>
                  <div>
                    <strong>
                      {scenarioLabels[scenario as keyof typeof scenarioLabels]}
                    </strong>
                    <span>{result.total} synthetic cases</span>
                  </div>
                  <div className="scenario-score">
                    <span>
                      {Math.round(result.score / result.total)}/12 AVG
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

        <footer className="quality-footer">
          <span>DATASET: {evaluation.datasetVersion}</span>
          <span>PROMPT: {evaluation.promptVersion}</span>
          <span>BASELINE: {evaluation.model}</span>
          <code>npm run eval</code>
        </footer>
      </section>
    </>
  );
}

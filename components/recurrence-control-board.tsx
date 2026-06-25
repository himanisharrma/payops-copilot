"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDot,
  GitBranch,
  History,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { operationsDrilldown } from "@/lib/insights";
import { providerName } from "@/lib/provider-webhooks";
import type {
  RecurrenceSuggestion,
  RemediationProgram,
  RemediationProgramsWorkspace,
} from "@/lib/types";

const exceptionLabels = {
  amount_mismatch: "Amount mismatch",
  missing_settlement: "Missing settlement",
  gateway_missing: "Gateway missing",
  duplicate: "Duplicate",
};

const statusLabels = {
  active: "Active",
  monitoring: "Monitoring",
  verified: "Verified",
  abandoned: "Abandoned",
};

const eventLabels = {
  program_created: "Program created",
  program_updated: "Program updated",
  case_linked: "Case linked",
  implementation_started: "Monitoring started",
  program_verified: "Fix verified",
  program_abandoned: "Program abandoned",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function fingerprintLabel(
  item: Pick<
    RecurrenceSuggestion,
    "providerId" | "paymentMode" | "reconciliationStatus" | "caseOrigin"
  >,
) {
  return `${providerName(item.providerId)} · ${item.paymentMode} · ${
    exceptionLabels[item.reconciliationStatus]
  } · ${item.caseOrigin.replaceAll("_", " ")}`;
}

async function apiMutation(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "The program could not be updated.");
  }
  return payload;
}

function VerificationRail({ program }: { program: RemediationProgram }) {
  const runs = program.cleanRuns.slice(-2);
  return (
    <div className="verification-rail">
      <div className="verification-line" aria-hidden="true" />
      {[0, 1].map((index) => {
        const run = runs[index];
        const state = run ? (run.clean ? "clean" : "failed") : "waiting";
        return (
          <div className={`verification-stop ${state}`} key={index}>
            <span>
              {state === "clean" ? (
                <Check size={14} />
              ) : state === "failed" ? (
                <X size={14} />
              ) : (
                index + 1
              )}
            </span>
            <div>
              <strong>{run?.runName ?? `Clean run ${index + 1}`}</strong>
              <small>
                {run
                  ? `${run.recurringExceptions} matching exceptions · ${shortDate(run.createdAt)}`
                  : "Awaiting a qualifying completed run"}
              </small>
            </div>
          </div>
        );
      })}
      <div
        className={`verification-stop conclusion ${
          program.status === "verified" ? "clean" : "waiting"
        }`}
      >
        <span><BadgeCheck size={15} /></span>
        <div>
          <strong>Administrator verification</strong>
          <small>
            {program.verifiedAt
              ? `${program.verifiedByName} · ${shortDate(program.verifiedAt)}`
              : "Observed absence, not a permanent provider guarantee"}
          </small>
        </div>
      </div>
    </div>
  );
}

export function RecurrenceControlBoard({
  workspace,
  role,
}: {
  workspace: RemediationProgramsWorkspace;
  role: "admin" | "analyst" | "viewer";
}) {
  const router = useRouter();
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(
    null,
  );
  const [selectedProgram, setSelectedProgram] = useState<string | null>(
    workspace.programs[0]?.id ?? null,
  );
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const canManage = role !== "viewer";
  const activeSuggestion = workspace.suggestions.find(
    (item) => item.fingerprint === selectedSuggestion,
  );
  const activeProgram =
    workspace.programs.find((item) => item.id === selectedProgram) ??
    workspace.programs[0];
  const maxTrend = useMemo(
    () =>
      Math.max(
        1,
        ...workspace.programs.map((program) => program.linkedCases.length),
      ),
    [workspace.programs],
  );

  function setFilter(key: string, value: string) {
    const next = { ...workspace.filters, [key]: value };
    const params = new URLSearchParams();
    for (const [filterKey, filterValue] of Object.entries(next)) {
      if (filterValue !== "all") params.set(filterKey, filterValue);
    }
    router.push(`/root-causes${params.size ? `?${params}` : ""}`);
  }

  function mutate(url: string, method: "POST" | "PATCH", body: unknown) {
    setError("");
    startTransition(async () => {
      try {
        const result = await apiMutation(url, method, body);
        setSelectedSuggestion(null);
        if (result.id) setSelectedProgram(result.id);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Update failed.");
      }
    });
  }

  return (
    <>
      <section className="workspace-hero compact-hero root-cause-hero">
        <div>
          <p className="kicker">
            <span>RECURRENCE CONTROL</span>
            <span>DETERMINISTIC ROOT CAUSES</span>
          </p>
          <h1>Stop resolving the same exception twice.</h1>
          <p>
            Group repeated payment failures from persisted facts, assign a
            governed fix, and verify the result against subsequent clean runs.
          </p>
        </div>
        <div className="root-cause-method">
          <GitBranch size={19} />
          <span>FINGERPRINT CONTRACT</span>
          <strong>Provider + mode + exception + origin</strong>
          <small>No notes, AI output, or free text influence detection.</small>
        </div>
      </section>

      <section className="root-cause-kpis" aria-label="Root cause metrics">
        <article>
          <span>SUGGESTED CLUSTERS</span>
          <strong>{workspace.summary.suggestedClusters}</strong>
          <small>3+ cases in the trailing 30 days</small>
        </article>
        <article>
          <span>RECURRING EXPOSURE</span>
          <strong>{money(workspace.summary.recurringExposure)}</strong>
          <small>Deterministic case exposure</small>
        </article>
        <article>
          <span>OPEN PROGRAMS</span>
          <strong>{workspace.summary.openPrograms}</strong>
          <small>Active or under monitoring</small>
        </article>
        <article className="verified">
          <span>VERIFIED FIXES</span>
          <strong>{workspace.summary.verifiedPrograms}</strong>
          <small>Two clean runs + administrator review</small>
        </article>
      </section>

      <section className="root-cause-filters" aria-label="Program filters">
        <label>
          PROVIDER
          <select
            value={workspace.filters.provider}
            onChange={(event) => setFilter("provider", event.target.value)}
          >
            <option value="all">All providers</option>
            {workspace.options.providers.map((provider) => (
              <option value={provider} key={provider}>
                {providerName(provider)}
              </option>
            ))}
          </select>
        </label>
        <label>
          PAYMENT MODE
          <select
            value={workspace.filters.paymentMode}
            onChange={(event) => setFilter("paymentMode", event.target.value)}
          >
            <option value="all">All payment modes</option>
            {workspace.options.paymentModes.map((mode) => (
              <option value={mode} key={mode}>{mode}</option>
            ))}
          </select>
        </label>
        <label>
          PROGRAM STATUS
          <select
            value={workspace.filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="root-cause-window">
          <CalendarClock size={17} />
          <span>Detection window</span>
          <strong>Trailing 30 days</strong>
        </div>
      </section>

      {error && <div className="root-cause-error" role="alert">{error}</div>}

      {!workspace.suggestions.length && !workspace.programs.length ? (
        <section className="root-cause-empty">
          <Sparkles size={28} />
          <h2>No recurring exception pattern detected.</h2>
          <p>
            This is an honest empty state: no deterministic fingerprint has
            reached three actionable cases during the trailing 30 days.
          </p>
          <Link href="/operations">Review current Operations queue</Link>
        </section>
      ) : (
        <div className="root-cause-board">
          <section className="suggestion-lane">
            <header>
              <div>
                <span>DETECTION QUEUE</span>
                <h2>Suggested clusters</h2>
              </div>
              <strong>{workspace.suggestions.length}</strong>
            </header>
            <div className="suggestion-stack">
              {workspace.suggestions.map((suggestion, index) => (
                <article
                  className={`suggestion-card ${
                    suggestion.promoted ? "promoted" : ""
                  }`}
                  key={suggestion.fingerprint}
                >
                  <div className="suggestion-rank">#{index + 1}</div>
                  <div className="suggestion-heading">
                    <span>{fingerprintLabel(suggestion)}</span>
                    {suggestion.promoted && <em>PROGRAM OPEN</em>}
                  </div>
                  <div className="suggestion-metrics">
                    <div><strong>{suggestion.caseCount}</strong><span>cases</span></div>
                    <div><strong>{money(suggestion.exposure)}</strong><span>exposure</span></div>
                    <div><strong>{suggestion.breachedCases}</strong><span>SLA breaches</span></div>
                    <div><strong>{suggestion.openCases}</strong><span>still open</span></div>
                  </div>
                  <footer>
                    <span>
                      Latest occurrence {shortDate(suggestion.lastOccurredAt)}
                    </span>
                    <Link
                      href={operationsDrilldown({
                        provider: suggestion.providerId,
                        paymentMode: suggestion.paymentMode,
                        exception: suggestion.reconciliationStatus,
                      })}
                    >
                      Inspect cases <ArrowRight size={13} />
                    </Link>
                    {canManage && !suggestion.promoted && (
                      <button
                        onClick={() =>
                          setSelectedSuggestion(suggestion.fingerprint)
                        }
                      >
                        Promote
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </section>

          <section className="program-lane">
            <header>
              <div>
                <span>REMEDIATION PORTFOLIO</span>
                <h2>Governed programs</h2>
              </div>
              <strong>{workspace.programs.length}</strong>
            </header>
            <div className="program-index">
              {workspace.programs.map((program) => (
                <button
                  className={program.id === activeProgram?.id ? "active" : ""}
                  key={program.id}
                  onClick={() => setSelectedProgram(program.id)}
                >
                  <span className={`program-status ${program.status}`}>
                    {statusLabels[program.status]}
                  </span>
                  <strong>{exceptionLabels[program.reconciliationStatus]}</strong>
                  <small>{providerName(program.providerId)} · {program.paymentMode}</small>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>

            {activeProgram && (
              <article className="program-detail">
                <header>
                  <div>
                    <span className={`program-status ${activeProgram.status}`}>
                      {statusLabels[activeProgram.status]}
                    </span>
                    <h2>{exceptionLabels[activeProgram.reconciliationStatus]}</h2>
                    <p>{fingerprintLabel(activeProgram)}</p>
                  </div>
                  <Link
                    href={operationsDrilldown({
                      provider: activeProgram.providerId,
                      paymentMode: activeProgram.paymentMode,
                      exception: activeProgram.reconciliationStatus,
                    })}
                  >
                    Open queue <ArrowRight size={14} />
                  </Link>
                </header>

                <div className="program-facts">
                  <div><UserRoundCheck size={15} /><span>Owner</span><strong>{activeProgram.ownerName}</strong></div>
                  <div><Target size={15} /><span>Target</span><strong>{shortDate(activeProgram.targetDate)}</strong></div>
                  <div><TriangleAlert size={15} /><span>Baseline</span><strong>{activeProgram.baselineCaseCount} cases · {money(activeProgram.baselineExposure)}</strong></div>
                </div>

                <section className="program-plan">
                  <span>REMEDIATION PLAN</span>
                  <p>{activeProgram.remediationPlan}</p>
                  {activeProgram.implementationSummary && (
                    <div>
                      <strong>Implementation evidence</strong>
                      <p>{activeProgram.implementationSummary}</p>
                      <code>{activeProgram.implementationEvidenceReference}</code>
                    </div>
                  )}
                </section>

                <section className="program-trend">
                  <header>
                    <div>
                      <span>BEFORE / AFTER SIGNAL</span>
                      <h3>Linked recurrence timeline</h3>
                    </div>
                    <strong>{activeProgram.linkedCases.length} cases</strong>
                  </header>
                  <div className="recurrence-bars">
                    {activeProgram.linkedCases.slice(-12).map((linkedCase) => (
                      <Link
                        href={operationsDrilldown({ caseId: linkedCase.id })}
                        key={`${linkedCase.id}-${linkedCase.linkedAt}`}
                        title={`${linkedCase.orderId}: ${money(linkedCase.exposure)}`}
                      >
                        <i
                          style={{
                            height: `${Math.max(
                              14,
                              (activeProgram.linkedCases.length / maxTrend) * 100,
                            )}%`,
                          }}
                        />
                        <span>{linkedCase.linkType === "automatic" ? "A" : "B"}</span>
                      </Link>
                    ))}
                  </div>
                  <footer>
                    <span>B = baseline window</span>
                    <span>A = automatically linked after promotion</span>
                  </footer>
                </section>

                {activeProgram.implementedAt && (
                  <section className="program-verification">
                    <header>
                      <div>
                        <span>VERIFICATION EVIDENCE</span>
                        <h3>Two subsequent clean runs</h3>
                      </div>
                      <ShieldCheck size={19} />
                    </header>
                    <VerificationRail program={activeProgram} />
                  </section>
                )}

                <section className="program-history">
                  <header>
                    <History size={16} />
                    <div>
                      <span>APPEND-ONLY HISTORY</span>
                      <h3>Program evidence ledger</h3>
                    </div>
                  </header>
                  <div>
                    {activeProgram.events.map((event) => (
                      <article key={event.id}>
                        <CircleDot size={13} />
                        <div>
                          <strong>{eventLabels[event.eventType]}</strong>
                          <span>{event.actorName} · {shortDate(event.createdAt)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                {canManage &&
                  ["active", "monitoring"].includes(activeProgram.status) && (
                    <details className="program-actions">
                      <summary>Manage program</summary>
                      <ProgramActions
                        program={activeProgram}
                        owners={workspace.options.owners}
                        role={role}
                        pending={isPending}
                        onSubmit={(body) =>
                          mutate(
                            `/api/remediation-programs/${activeProgram.id}`,
                            "PATCH",
                            body,
                          )
                        }
                      />
                    </details>
                  )}
              </article>
            )}
          </section>
        </div>
      )}

      {activeSuggestion && canManage && (
        <div className="promotion-backdrop" role="presentation">
          <section
            className="promotion-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="promotion-title"
          >
            <header>
              <div>
                <span>EXPLICIT PROMOTION</span>
                <h2 id="promotion-title">Create remediation program</h2>
              </div>
              <button
                aria-label="Close promotion panel"
                onClick={() => setSelectedSuggestion(null)}
              >
                <X size={18} />
              </button>
            </header>
            <p>{fingerprintLabel(activeSuggestion)}</p>
            <div className="promotion-evidence">
              <strong>{activeSuggestion.caseCount} cases</strong>
              <strong>{money(activeSuggestion.exposure)}</strong>
              <span>
                The matching detection-window cases will be linked as baseline
                evidence. Future matching cases link automatically.
              </span>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                mutate("/api/remediation-programs", "POST", {
                  fingerprint: activeSuggestion.fingerprint,
                  ownerUserId: data.get("ownerUserId"),
                  targetDate: data.get("targetDate"),
                  remediationPlan: data.get("remediationPlan"),
                });
              }}
            >
              <label>
                PROGRAM OWNER
                <select name="ownerUserId" required>
                  <option value="">Select an owner</option>
                  {workspace.options.owners.map((owner) => (
                    <option value={owner.id} key={owner.id}>
                      {owner.name} · {owner.role}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                TARGET DATE
                <input
                  name="targetDate"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  required
                />
              </label>
              <label className="full">
                REMEDIATION PLAN
                <textarea
                  name="remediationPlan"
                  minLength={20}
                  placeholder="Describe the deterministic operational or integration change to implement…"
                  required
                />
              </label>
              <button disabled={isPending}>
                {isPending ? "Creating…" : "Create governed program"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function ProgramActions({
  program,
  owners,
  role,
  pending,
  onSubmit,
}: {
  program: RemediationProgram;
  owners: RemediationProgramsWorkspace["options"]["owners"];
  role: "admin" | "analyst" | "viewer";
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [abandoning, setAbandoning] = useState(false);
  if (program.status === "active") {
    return (
      <div className="program-action-grid">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit({
              ownerUserId: data.get("ownerUserId"),
              remediationPlan: data.get("remediationPlan"),
              targetDate: data.get("targetDate"),
            });
          }}
        >
          <label>OWNER<select name="ownerUserId" defaultValue={program.ownerUserId}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
          <label>TARGET<input name="targetDate" type="date" defaultValue={program.targetDate.slice(0, 10)} /></label>
          <label className="full">PLAN<textarea name="remediationPlan" minLength={20} defaultValue={program.remediationPlan} /></label>
          <button disabled={pending}>Save program</button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit({
              implementationSummary: data.get("implementationSummary"),
              implementationEvidenceReference: data.get(
                "implementationEvidenceReference",
              ),
            });
          }}
        >
          <label className="full">IMPLEMENTATION SUMMARY<textarea name="implementationSummary" minLength={20} placeholder="What changed, where, and when?" required /></label>
          <label className="full">EVIDENCE REFERENCE<input name="implementationEvidenceReference" placeholder="Change ticket, commit, or synthetic reference" minLength={5} required /></label>
          <button disabled={pending}>Begin monitoring</button>
        </form>
        {role === "admin" && (
          <AbandonControl
            abandoning={abandoning}
            setAbandoning={setAbandoning}
            pending={pending}
            onSubmit={onSubmit}
          />
        )}
      </div>
    );
  }
  return (
    <div className="program-action-grid compact">
      <button
        disabled={
          pending ||
          role !== "admin" ||
          program.cleanRuns.slice(-2).length < 2 ||
          program.cleanRuns.slice(-2).some((run) => !run.clean)
        }
        onClick={() => onSubmit({ action: "verify" })}
      >
        Verify two clean runs
      </button>
      {role === "admin" && (
        <AbandonControl
          abandoning={abandoning}
          setAbandoning={setAbandoning}
          pending={pending}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

function AbandonControl({
  abandoning,
  setAbandoning,
  pending,
  onSubmit,
}: {
  abandoning: boolean;
  setAbandoning: (value: boolean) => void;
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  if (!abandoning) {
    return (
      <button className="destructive" onClick={() => setAbandoning(true)}>
        Abandon program
      </button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({ action: "abandon", reason: data.get("reason") });
      }}
    >
      <label className="full">ABANDONMENT REASON<textarea name="reason" minLength={10} required /></label>
      <button className="destructive" disabled={pending}>Confirm abandonment</button>
    </form>
  );
}

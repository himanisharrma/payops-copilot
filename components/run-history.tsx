"use client";

import { ArrowUpRight, Database, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/types";

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function RunHistory() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/runs");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setRuns(payload.runs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "History unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/runs")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.runs as RunSummary[];
      })
      .then((loadedRuns) => {
        if (active) setRuns(loadedRuns);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "History unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <section className="workspace-hero compact-hero">
        <div>
          <p className="kicker">
            <span>RUN HISTORY</span>
            <span>POSTGRESQL LEDGER</span>
          </p>
          <h1>Every reconciliation, preserved.</h1>
          <p>
            Track operational quality over time and maintain a durable audit
            trail for every uploaded report.
          </p>
        </div>
        <button className="demo-button" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </section>

      <section className="history-section">
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <div className="loading-state">
            <LoaderCircle className="spin" /> Loading run history…
          </div>
        ) : runs.length ? (
          <div className="history-grid">
            {runs.map((run, index) => (
              <article className="run-card" key={run.id}>
                <div className="run-card-head">
                  <span>RUN / {String(runs.length - index).padStart(3, "0")}</span>
                  <Database size={17} />
                </div>
                <p className="run-date">
                  {new Date(run.createdAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                <h2>{run.name}</h2>
                <div className="run-score">
                  <strong>{run.matchRate}%</strong>
                  <span>MATCH RATE</span>
                </div>
                <div className="run-card-metrics">
                  <div>
                    <span>PROCESSED</span>
                    <strong>{money(run.processedValue)}</strong>
                  </div>
                  <div>
                    <span>EXCEPTIONS</span>
                    <strong>{run.exceptionCount}</strong>
                  </div>
                  <div>
                    <span>ORDERS</span>
                    <strong>{run.totalOrders}</strong>
                  </div>
                </div>
                <footer>
                  <span>{run.sourceType.toUpperCase()} SOURCE</span>
                  <ArrowUpRight size={15} />
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="loading-state">
            <Database />
            No saved runs yet. Complete a reconciliation first.
          </div>
        )}
      </section>
    </>
  );
}

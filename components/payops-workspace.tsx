"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileSpreadsheet,
  Filter,
  Landmark,
  ListChecks,
  LoaderCircle,
  History,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import type {
  RawRecord,
  ReconciliationItem,
  ReconciliationResult,
  ReconciliationStatus,
} from "@/lib/types";

type SourceKey = "orders" | "gateway" | "settlements";
type UploadState = Record<SourceKey, RawRecord[]>;
type FileNames = Record<SourceKey, string>;
type FilterKey = "all" | "exceptions" | ReconciliationStatus;

const emptyUploads: UploadState = {
  orders: [],
  gateway: [],
  settlements: [],
};

const sourceConfig: Array<{
  key: SourceKey;
  eyebrow: string;
  title: string;
  helper: string;
}> = [
  {
    key: "orders",
    eyebrow: "01 · SOURCE",
    title: "Internal orders",
    helper: "Your source of truth for expected payments",
  },
  {
    key: "gateway",
    eyebrow: "02 · PROCESSOR",
    title: "Gateway report",
    helper: "Captures, fees, payment modes and status",
  },
  {
    key: "settlements",
    eyebrow: "03 · DESTINATION",
    title: "Bank settlement",
    helper: "Net transfers and bank UTR references",
  },
];

const statusLabels: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_settlement: "Missing settlement",
  gateway_missing: "Gateway missing",
  duplicate: "Duplicate capture",
  pending: "Pending",
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function parseCsv(text: string) {
  const result = Papa.parse<RawRecord>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (header) => header.trim(),
  });

  if (result.errors.length) {
    throw new Error(result.errors[0].message);
  }

  return result.data;
}

async function readFile(file: File) {
  return parseCsv(await file.text());
}

export function PayOpsWorkspace() {
  const [uploads, setUploads] = useState<UploadState>(emptyUploads);
  const [fileNames, setFileNames] = useState<FileNames>({
    orders: "",
    gateway: "",
    settlements: "",
  });
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [selected, setSelected] = useState<ReconciliationItem | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const ready = Object.values(uploads).every((rows) => rows.length > 0);

  async function reconcile(
    nextUploads = uploads,
    nextFileNames = fileNames,
    nextSourceType: "demo" | "upload" = "upload",
  ) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...nextUploads,
          runName: `Settlement run · ${new Date().toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          sourceType: nextSourceType,
          sourceFiles: nextFileNames,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setResult(payload);
      setSelected(null);
      setFilter("all");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Reconciliation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDemo() {
    setLoading(true);
    setError("");

    try {
      const entries = await Promise.all(
        sourceConfig.map(async ({ key }) => {
          const response = await fetch(`/demo/${key}.csv`);
          return [key, parseCsv(await response.text())] as const;
        }),
      );
      const nextUploads = Object.fromEntries(entries) as UploadState;
      setUploads(nextUploads);
      const demoFileNames = {
        orders: "orders.csv",
        gateway: "gateway.csv",
        settlements: "settlements.csv",
      };
      setFileNames(demoFileNames);
      await reconcile(nextUploads, demoFileNames, "demo");
    } catch {
      setError("The demo files could not be loaded.");
      setLoading(false);
    }
  }

  async function handleFile(key: SourceKey, file?: File) {
    if (!file) return;
    setError("");

    try {
      const rows = await readFile(file);
      setUploads((current) => ({ ...current, [key]: rows }));
      setFileNames((current) => ({ ...current, [key]: file.name }));
      setResult(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That CSV could not be read.",
      );
    }
  }

  const visibleItems = useMemo(() => {
    if (!result) return [];
    const normalizedQuery = query.toLowerCase().trim();

    return result.items.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "exceptions" &&
          !["matched", "pending"].includes(item.status)) ||
        item.status === filter;
      const matchesQuery =
        !normalizedQuery ||
        item.orderId.toLowerCase().includes(normalizedQuery) ||
        item.gatewayReference.toLowerCase().includes(normalizedQuery) ||
        item.paymentMode.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, result]);

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="PayOps Copilot home">
          <span className="brand-mark">P</span>
          <span>
            PAYOPS
            <small>COPILOT</small>
          </span>
        </a>
        <div className="environment">
          <span className="live-dot" />
          SYNTHETIC DATA · SAFE MODE
        </div>
        <nav className="top-actions" aria-label="Workspace utilities">
          <a href="/operations" className="text-link nav-link">
            <ListChecks size={15} />
            Operations
          </a>
          <a href="/runs" className="text-link nav-link">
            <History size={15} />
            Runs
          </a>
          <a href="/product-brief" className="text-link">
            Product brief
          </a>
          <button className="icon-button" title="Help" aria-label="Help">
            <CircleHelp size={18} />
          </button>
          <div className="avatar" aria-label="Portfolio workspace">
            HS
          </div>
        </nav>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">
            <span>RECONCILIATION WORKSPACE</span>
            <span>RUN / 001</span>
          </p>
          <h1>
            Find the money
            <br />
            that <em>didn&apos;t</em> arrive.
          </h1>
          <p className="hero-copy">
            Compare internal orders, gateway captures, and bank settlements.
            Every exception comes with evidence you can act on.
          </p>
        </div>
        <div className="hero-aside">
          <div className="trust-stamp">
            <ShieldCheck size={24} />
            <span>
              CALCULATIONS
              <strong>DETERMINISTIC</strong>
            </span>
          </div>
          <p>
            No real payments or credentials. Results are stored in your
            PostgreSQL workspace.
          </p>
        </div>
      </section>

      <section className="flow-section" aria-labelledby="upload-heading">
        <div className="section-heading">
          <div>
            <span className="section-index">01</span>
            <div>
              <p className="eyebrow">ADD YOUR REPORTS</p>
              <h2 id="upload-heading">Three files. One truth.</h2>
            </div>
          </div>
          <button className="demo-button" onClick={loadDemo} disabled={loading}>
            <Sparkles size={16} />
            Load demo data
          </button>
        </div>

        <div className="upload-flow">
          {sourceConfig.map((source, index) => {
            const rows = uploads[source.key];
            return (
              <div className="flow-fragment" key={source.key}>
                <label
                  className={`upload-card ${rows.length ? "is-ready" : ""}`}
                >
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) =>
                      handleFile(source.key, event.target.files?.[0])
                    }
                  />
                  <div className="upload-card-top">
                    <span>{source.eyebrow}</span>
                    {rows.length ? (
                      <span className="ready-check">
                        <Check size={14} /> READY
                      </span>
                    ) : (
                      <FileSpreadsheet size={20} />
                    )}
                  </div>
                  <div className="upload-icon">
                    {rows.length ? (
                      <BadgeCheck size={31} />
                    ) : (
                      <Upload size={29} />
                    )}
                  </div>
                  <h3>{source.title}</h3>
                  <p>{source.helper}</p>
                  <div className="file-meta">
                    <strong>
                      {rows.length
                        ? fileNames[source.key]
                        : "Choose a CSV file"}
                    </strong>
                    <span>
                      {rows.length ? `${rows.length} rows detected` : "CSV · 10 MB max"}
                    </span>
                  </div>
                </label>
                {index < sourceConfig.length - 1 && (
                  <div className="flow-arrow" aria-hidden="true">
                    <ArrowRight size={24} />
                    <span>MATCH</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}

        <div className="run-row">
          <p>
            <ShieldCheck size={16} />
            We normalize common headers automatically and never discard a row.
          </p>
          <button
            className="primary-button"
            disabled={!ready || loading}
            onClick={() => reconcile(uploads, fileNames, "upload")}
          >
            {loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Banknote size={18} />
            )}
            {loading ? "Reconciling…" : "Run reconciliation"}
            {!loading && <ArrowRight size={17} />}
          </button>
        </div>
      </section>

      {result ? (
        <section className="results-section" aria-labelledby="results-heading">
          <div className="section-heading results-heading">
            <div>
              <span className="section-index">02</span>
              <div>
                <p className="eyebrow">RECONCILIATION RESULT</p>
                <h2 id="results-heading">Your settlement pulse.</h2>
              </div>
            </div>
            <p className="run-time">
              RUN COMPLETE ·{" "}
              {new Date(result.generatedAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          <div className="metric-grid">
            <article className="metric-card metric-primary">
              <p>MATCH RATE</p>
              <strong>{result.summary.matchRate}%</strong>
              <span>
                {result.summary.matchedCount} of {result.summary.totalOrders} orders
              </span>
              <div className="meter">
                <i style={{ width: `${result.summary.matchRate}%` }} />
              </div>
            </article>
            <article className="metric-card">
              <p>PROCESSED VALUE</p>
              <strong>{formatMoney(result.summary.processedValue)}</strong>
              <span>Across uploaded orders</span>
            </article>
            <article className="metric-card danger">
              <p>VALUE TO INVESTIGATE</p>
              <strong>{formatMoney(result.summary.unmatchedValue)}</strong>
              <span>{result.summary.exceptionCount} actionable exceptions</span>
            </article>
            <article className="metric-card">
              <p>CONTROL STATUS</p>
              <strong className="status-copy">
                {result.summary.exceptionCount ? "REVIEW" : "CLEAR"}
              </strong>
              <span>
                {result.summary.exceptionCount
                  ? "Human action required"
                  : "No exceptions found"}
              </span>
            </article>
          </div>

          <div className="ledger">
            <div className="ledger-toolbar">
              <div className="filter-group" aria-label="Filter transactions">
                {[
                  ["all", "All"],
                  ["exceptions", "Exceptions"],
                  ["matched", "Matched"],
                  ["pending", "Pending"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={filter === value ? "active" : ""}
                    onClick={() => setFilter(value as FilterKey)}
                  >
                    {label}
                    {value === "exceptions" && (
                      <span>{result.summary.exceptionCount}</span>
                    )}
                  </button>
                ))}
              </div>
              <label className="search-box">
                <Search size={16} />
                <span className="sr-only">Search transactions</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search order or reference"
                />
              </label>
              <button className="filter-button" title="More filters">
                <Filter size={16} /> Filters
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>STATUS</th>
                    <th>ORDER ID</th>
                    <th>PAYMENT RAIL</th>
                    <th>ORDER</th>
                    <th>EXPECTED NET</th>
                    <th>SETTLED</th>
                    <th>VARIANCE</th>
                    <th aria-label="Open evidence" />
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr
                      key={item.orderId}
                      onClick={() => setSelected(item)}
                      className={item.status !== "matched" ? "has-issue" : ""}
                    >
                      <td>
                        <span className={`status-pill ${item.status}`}>
                          <i />
                          {statusLabels[item.status]}
                        </span>
                      </td>
                      <td>
                        <strong className="mono">{item.orderId}</strong>
                        <small className="mono">{item.gatewayReference}</small>
                      </td>
                      <td>{item.paymentMode}</td>
                      <td className="mono">{formatMoney(item.orderAmount)}</td>
                      <td className="mono">
                        {item.expectedNet === null
                          ? "—"
                          : formatMoney(item.expectedNet)}
                      </td>
                      <td className="mono">
                        {item.settledAmount === null
                          ? "—"
                          : formatMoney(item.settledAmount)}
                      </td>
                      <td
                        className={`mono ${
                          item.variance ? "variance" : "muted"
                        }`}
                      >
                        {item.variance
                          ? `${item.variance > 0 ? "+" : ""}${formatMoney(
                              item.variance,
                            )}`
                          : "₹0"}
                      </td>
                      <td>
                        <ChevronRight size={17} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleItems.length && (
                <div className="empty-state">
                  <Search size={24} />
                  <strong>No transactions found</strong>
                  <span>Try a different search or filter.</span>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="waiting-section">
          <Landmark size={29} />
          <div>
            <p className="eyebrow">THE RESULT APPEARS HERE</p>
            <h2>Load the demo to see PayOps Copilot in action.</h2>
          </div>
          <ArrowRight size={22} />
        </section>
      )}

      <footer>
        <span>PAYOPS COPILOT · PORTFOLIO MVP</span>
        <span>BUILT FOR EVIDENCE-FIRST PAYMENT OPERATIONS</span>
      </footer>

      {selected && (
        <div
          className="drawer-backdrop"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <aside
            className="evidence-drawer"
            aria-label={`Evidence for ${selected.orderId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="drawer-close"
              onClick={() => setSelected(null)}
              aria-label="Close evidence"
            >
              <X size={19} />
            </button>
            <p className="eyebrow">EXCEPTION EVIDENCE</p>
            <div className={`drawer-icon ${selected.status}`}>
              {selected.status === "matched" ? (
                <BadgeCheck size={28} />
              ) : selected.status === "pending" ? (
                <Clock3 size={28} />
              ) : (
                <AlertTriangle size={28} />
              )}
            </div>
            <h2>{selected.orderId}</h2>
            <span className={`status-pill ${selected.status}`}>
              <i />
              {statusLabels[selected.status]}
            </span>
            <p className="drawer-summary">{selected.summary}</p>

            <div className="money-trail">
              <div>
                <span>ORDER</span>
                <strong>{formatMoney(selected.orderAmount)}</strong>
              </div>
              <ArrowRight size={17} />
              <div>
                <span>EXPECTED</span>
                <strong>
                  {selected.expectedNet === null
                    ? "—"
                    : formatMoney(selected.expectedNet)}
                </strong>
              </div>
              <ArrowRight size={17} />
              <div>
                <span>SETTLED</span>
                <strong>
                  {selected.settledAmount === null
                    ? "—"
                    : formatMoney(selected.settledAmount)}
                </strong>
              </div>
            </div>

            <div className="evidence-list">
              <p>EVIDENCE TRAIL</p>
              {selected.evidence.map((evidence, index) => (
                <div key={evidence}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{evidence}</p>
                </div>
              ))}
            </div>

            <div className="suggested-action">
              <Sparkles size={18} />
              <div>
                <span>SUGGESTED NEXT STEP</span>
                <p>
                  {selected.status === "matched"
                    ? "No action needed. Keep this transaction in the audit record."
                    : selected.status === "pending"
                      ? "Wait for the gateway status to become final, then run reconciliation again."
                      : "Confirm the source row with the payment provider before changing any financial record."}
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

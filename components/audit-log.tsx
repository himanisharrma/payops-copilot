"use client";

import { FileClock, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditEvent } from "@/lib/types";

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/audit")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.events as AuditEvent[];
      })
      .then((items) => active && setEvents(items))
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Audit log unavailable.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <section className="workspace-hero compact-hero">
        <div>
          <p className="kicker"><span>AUDIT LEDGER</span><span>ADMIN ONLY</span></p>
          <h1>Who changed what, and when.</h1>
          <p>Immutable operational events make sensitive payment workflows reviewable and accountable.</p>
        </div>
        <ShieldCheck size={52} />
      </section>
      <section className="audit-section">
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <div className="loading-state"><LoaderCircle className="spin" />Loading audit events…</div>
        ) : (
          <div className="audit-list">
            {events.map((event) => (
              <article key={event.id}>
                <FileClock size={18} />
                <div>
                  <p>{event.action.replaceAll(".", " ")}</p>
                  <span>{event.entityType} · {event.entityId.slice(0, 8)}</span>
                </div>
                <strong>{event.actorName}</strong>
                <time>{new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
              </article>
            ))}
            {!events.length && <div className="loading-state">No audited actions yet.</div>}
          </div>
        )}
      </section>
    </>
  );
}

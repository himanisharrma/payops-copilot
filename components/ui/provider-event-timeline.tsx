import { AlertTriangle } from "lucide-react";
import type { NormalizedProviderEvent } from "@/lib/types";

export function ProviderEventTimeline({
  events = [],
  emptyMessage,
  formatDateTime,
  preferReference = "payment",
}: {
  events?: NormalizedProviderEvent[];
  emptyMessage: string;
  formatDateTime: (value: string) => string;
  preferReference?: "payment" | "external";
}) {
  return (
    <section className="provider-event-panel">
      <div className="timeline-heading">
        <span>SYNTHETIC PROVIDER EVENTS</span>
        <small>{events.length} events</small>
      </div>
      {events.length ? (
        events.map((event) => {
          const reference =
            preferReference === "payment"
              ? event.paymentReference ?? event.externalReference
              : event.externalReference ?? event.paymentReference;
          return (
            <article key={event.id}>
              <i />
              <div>
                <strong>{event.title}</strong>
                <p>
                  {reference} · {formatDateTime(event.occurredAt)}
                </p>
                <dl>
                  <div>
                    <dt>Proves</dt>
                    <dd>{event.proves}</dd>
                  </div>
                  <div>
                    <dt>Does not prove</dt>
                    <dd>{event.doesNotProve}</dd>
                  </div>
                </dl>
              </div>
            </article>
          );
        })
      ) : (
        <div className="provider-event-empty">
          <AlertTriangle size={15} />
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

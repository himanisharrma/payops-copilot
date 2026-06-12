import Link from "next/link";

const sections = [
  {
    title: "The user",
    body: "A payment operations analyst at an Indian merchant or payment aggregator who currently compares several reports by hand.",
  },
  {
    title: "The problem",
    body: "Order, gateway, and bank files use different schemas. Missing settlements, duplicate captures, and fee differences are slow to find and difficult to audit.",
  },
  {
    title: "The MVP",
    body: "Upload three CSV files and receive a transparent reconciliation report with prioritized exceptions and row-level evidence.",
  },
  {
    title: "The principle",
    body: "Evidence before explanation. Financial arithmetic stays deterministic, and a human approves every operational action.",
  },
];

export default function ProductBrief() {
  return (
    <main className="brief-page">
      <nav>
        <Link href="/">← Back to workspace</Link>
        <span>PAYOPS COPILOT / PRODUCT BRIEF</span>
      </nav>
      <header>
        <p className="eyebrow">PORTFOLIO PRODUCT · VERSION 0.1</p>
        <h1>Make payment exceptions obvious and auditable.</h1>
        <p>
          PayOps Copilot is an evidence-first reconciliation workspace for
          teams that need to understand why expected money and settled money
          disagree.
        </p>
      </header>
      <section>
        {sections.map((section, index) => (
          <article key={section.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
      <aside>
        <strong>Safety boundary</strong>
        <p>
          The public MVP uses fictional data, stores no payment credentials,
          and cannot initiate payments or refunds.
        </p>
      </aside>
    </main>
  );
}

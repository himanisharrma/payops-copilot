import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellRing,
  FileSearch,
  Gauge,
  Landmark,
  ReceiptText,
  Route,
  ShieldCheck,
  FileText,
  RadioTower,
  Waypoints,
} from "lucide-react";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";

const journey = [
  {
    number: "01",
    title: "Source readiness",
    control: "Expected merchant files are tracked before any recon run starts.",
    lookFor:
      "Daily expected-file registry, arrival SLA, hashes, CSV profiles, quarantines, duplicates, revisions, and close blockers.",
    href: "/source-ingestion",
    cta: "Open sources",
    icon: RadioTower,
  },
  {
    number: "02",
    title: "Reconciliation run",
    control: "Three source reports become one deterministic ledger.",
    lookFor:
      "Provider parsing, source-row hashes, matched value, and explicit exception categories.",
    href: "/runs",
    cta: "Open run history",
    icon: Landmark,
  },
  {
    number: "03",
    title: "Merchant settlement statement",
    control: "Gross collections become merchant payable after deductions.",
    lookFor:
      "MDR, GST, refunds, chargebacks, holds, net settlement, UTR state, bank credit evidence, and linked cases.",
    href: "/settlements",
    cta: "Open settlements",
    icon: ReceiptText,
  },
  {
    number: "04",
    title: "Statement import desk",
    control: "Provider-style statements are staged before becoming evidence.",
    lookFor:
      "CSV staging, deterministic row comparison, settlement exceptions, adjustment proposals, and evidence packet export.",
    href: "/settlement-imports",
    cta: "Open imports",
    icon: FileText,
  },
  {
    number: "05",
    title: "Exception case",
    control: "Actionable differences become owned operational work.",
    lookFor:
      "Priority, owner, SLA state, source evidence, and resolution controls.",
    href: "/operations?status=open&ownerState=unassigned",
    cta: "Open queue",
    icon: FileSearch,
  },
  {
    number: "06",
    title: "Settlement deadline evidence",
    control: "Aging is measured from the expected settlement time.",
    lookFor:
      "Cycle policy, India demo calendar, expected date, days overdue, and separate case SLA.",
    href: "/operations?origin=settlement&slaState=overdue",
    cta: "Inspect settlement cases",
    icon: Gauge,
  },
  {
    number: "07",
    title: "Signed webhook evidence",
    control: "Synthetic provider events are accepted only through the trust boundary.",
    lookFor:
      "Signature version, replay rejection, payload hash retention, and provider-event timelines.",
    href: "/webhook-operations",
    cta: "Open webhook trust",
    icon: ShieldCheck,
    adminOnly: true,
  },
  {
    number: "08",
    title: "Insights dashboard",
    control: "Managers see deterministic metrics, not analytics theatre.",
    lookFor:
      "30-day KPIs, current workload, exception mix, settlement performance, and drill-through filters.",
    href: "/insights",
    cta: "Open insights",
    icon: BellRing,
  },
  {
    number: "09",
    title: "Root-cause program verification",
    control: "Recurring exceptions become governed remediation programs.",
    lookFor:
      "Deterministic fingerprinting, linked cases, implementation evidence, and two clean runs.",
    href: "/root-causes",
    cta: "Open root causes",
    icon: Waypoints,
  },
];

export default async function DemoControlRoomPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const isAdmin = session.user.role === "admin";

  return (
    <main className="shell">
      <AppHeader active="demo" />
      <section className="workspace-hero compact-hero demo-control-hero">
        <div>
          <span>90-second reviewer path</span>
          <h1>Control Room Demo Mode</h1>
          <p>
            A guided briefing for portfolio reviewers: follow the evidence from
            reconciliation, to an owned exception, to settlement controls,
            webhook trust, management insight, and verified remediation.
          </p>
        </div>
        <aside className="demo-control-brief" aria-label="Demo guardrails">
          <Route size={28} />
          <span>Synthetic-only boundary</span>
          <strong>No live providers. No money movement. No real payment data.</strong>
          <p>
            Every link below opens an existing PayOps workspace backed by the
            seeded fictional organization.
          </p>
        </aside>
      </section>

      <section className="demo-control-page" aria-label="Control room demo">
        <div className="demo-control-ledger">
          <article>
            <span>Audience</span>
            <strong>Hiring managers, fintech PMs, product engineers</strong>
          </article>
          <article>
            <span>Time budget</span>
            <strong>90 seconds to understand the operating model</strong>
          </article>
          <article>
            <span>Your role</span>
            <strong>{session.user.name} · {session.user.role}</strong>
          </article>
        </div>

        <div className="demo-control-grid">
          {journey.map((step) => {
            const Icon = step.icon;
            const disabled = step.adminOnly && !isAdmin;
            return (
              <article
                className={`demo-control-step ${disabled ? "is-disabled" : ""}`}
                key={step.number}
              >
                <header>
                  <span>{step.number}</span>
                  <Icon size={22} />
                </header>
                <h2>{step.title}</h2>
                <p>{step.control}</p>
                <dl>
                  <div>
                    <dt>What to look for</dt>
                    <dd>{step.lookFor}</dd>
                  </div>
                </dl>
                {disabled ? (
                  <small>
                    Admin-only workspace. Sign in as an administrator to inspect
                    provider trust evidence.
                  </small>
                ) : (
                  <Link href={step.href}>{step.cta}</Link>
                )}
              </article>
            );
          })}
        </div>

        <section className="demo-control-proof">
          <div>
            <span>PM readout</span>
            <h2>What this walkthrough proves</h2>
          </div>
          <ul>
            <li>Financial classifications come from deterministic code.</li>
            <li>Evidence is persisted with organization scope and audit context.</li>
            <li>AI remains bounded to investigation drafts and human review.</li>
            <li>Managers can drill from aggregate signals into the work queue.</li>
            <li>Root-cause verification means two clean observed runs, not permanent provider proof.</li>
          </ul>
          <Link href="/product-brief">Open product brief</Link>
        </section>
      </section>
    </main>
  );
}

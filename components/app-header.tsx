import Link from "next/link";
import { History, ListChecks, Scale } from "lucide-react";

export function AppHeader({ active }: { active: "operations" | "runs" }) {
  return (
    <header className="topbar app-page-header">
      <Link className="brand" href="/" aria-label="PayOps Copilot home">
        <span className="brand-mark">P</span>
        <span>
          PAYOPS
          <small>COPILOT</small>
        </span>
      </Link>
      <nav className="product-nav" aria-label="Product navigation">
        <Link href="/" className="product-nav-link">
          <Scale size={15} />
          Reconcile
        </Link>
        <Link
          href="/operations"
          className={`product-nav-link ${active === "operations" ? "active" : ""}`}
        >
          <ListChecks size={15} />
          Operations
        </Link>
        <Link
          href="/runs"
          className={`product-nav-link ${active === "runs" ? "active" : ""}`}
        >
          <History size={15} />
          Run history
        </Link>
      </nav>
      <div className="environment">
        <span className="live-dot" />
        POSTGRESQL WORKSPACE
      </div>
    </header>
  );
}

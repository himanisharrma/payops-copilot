import Link from "next/link";
import { FileClock, History, ListChecks, LogOut, Scale } from "lucide-react";
import { auth, signOut } from "@/auth";

export async function AppHeader({
  active,
}: {
  active: "operations" | "runs" | "audit";
}) {
  const session = await auth();
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
        {session?.user.role === "admin" && (
          <Link
            href="/audit"
            className={`product-nav-link ${active === "audit" ? "active" : ""}`}
          >
            <FileClock size={15} />
            Audit
          </Link>
        )}
      </nav>
      <div className="session-identity">
        <span>
          <strong>{session?.user.organizationName}</strong>
          {session?.user.name} · {session?.user.role}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button aria-label="Sign out" title="Sign out">
            <LogOut size={16} />
          </button>
        </form>
      </div>
    </header>
  );
}

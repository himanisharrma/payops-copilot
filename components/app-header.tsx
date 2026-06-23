import Link from "next/link";
import {
  BookCheck,
  FileClock,
  FlaskConical,
  ChartNoAxesCombined,
  History,
  ListChecks,
  LogOut,
  RotateCcw,
  Scale,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { auth, signOut } from "@/auth";
import { NotificationCenter } from "@/components/notification-center";
import { getOperationalNotifications } from "@/lib/modules/notifications/service";

export async function AppHeader({
  active,
}: {
  active:
    | "operations"
    | "payments"
    | "runs"
    | "insights"
    | "root-causes"
    | "quality"
    | "close"
    | "webhooks"
    | "audit";
}) {
  const session = await auth();
  const actor = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "Unknown user",
        role: session.user.role,
        organizationId: session.user.organizationId,
        organizationName: session.user.organizationName,
      }
    : null;
  const notifications = actor
    ? await getOperationalNotifications(actor)
    : [];
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
          href="/refunds-disputes"
          className={`product-nav-link ${active === "payments" ? "active" : ""}`}
        >
          <RotateCcw size={15} />
          Refunds & disputes
        </Link>
        <Link
          href="/runs"
          className={`product-nav-link ${active === "runs" ? "active" : ""}`}
        >
          <History size={15} />
          Run history
        </Link>
        <Link
          href="/insights"
          className={`product-nav-link ${active === "insights" ? "active" : ""}`}
        >
          <ChartNoAxesCombined size={15} />
          Insights
        </Link>
        <Link
          href="/root-causes"
          className={`product-nav-link ${active === "root-causes" ? "active" : ""}`}
        >
          <Waypoints size={15} />
          Root causes
        </Link>
        <Link
          href="/close-control"
          className={`product-nav-link ${active === "close" ? "active" : ""}`}
        >
          <BookCheck size={15} />
          Daily close
        </Link>
        <Link
          href="/quality"
          className={`product-nav-link ${active === "quality" ? "active" : ""}`}
        >
          <FlaskConical size={15} />
          AI quality
        </Link>
        {session?.user.role === "admin" && (
          <Link
            href="/webhook-operations"
            className={`product-nav-link ${active === "webhooks" ? "active" : ""}`}
          >
            <ShieldCheck size={15} />
            Webhook trust
          </Link>
        )}
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
        <NotificationCenter
          initialNotifications={notifications}
          canManage={actor?.role !== "viewer"}
        />
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

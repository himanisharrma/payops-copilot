import Link from "next/link";
import {
  Banknote,
  FileText,
  History,
  ListChecks,
  LogOut,
  RadioTower,
  RotateCcw,
  Scale,
} from "lucide-react";
import { auth, signOut } from "@/auth";
import { NotificationCenter } from "@/components/notification-center";
import {
  SecondaryNavMenu,
  type SecondaryNavLink,
} from "@/components/secondary-nav-menu";
import { getOperationalNotifications } from "@/lib/modules/notifications/service";

export async function AppHeader({
  active,
}: {
  active:
    | "operations"
    | "sources"
    | "settlements"
    | "imports"
    | "payments"
    | "runs"
    | "insights"
    | "root-causes"
    | "demo"
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
  const isAdmin = session?.user.role === "admin";
  const secondaryLinks: SecondaryNavLink[] = [
    { href: "/insights", label: "Insights", key: "insights" },
    { href: "/root-causes", label: "Root causes", key: "root-causes" },
    { href: "/close-control", label: "Daily close", key: "close" },
    { href: "/quality", label: "AI quality", key: "quality" },
    { href: "/demo-control-room", label: "Demo", key: "demo" },
    ...(isAdmin
      ? ([
          {
            href: "/webhook-operations",
            label: "Webhook trust",
            key: "webhooks",
          },
          { href: "/audit", label: "Audit", key: "audit" },
        ] satisfies SecondaryNavLink[])
      : []),
  ];
  return (
    <header className="topbar app-page-header">
      <Link className="brand" href="/" aria-label="PayOps home">
        <span className="brand-mark">P</span>
        <span>PAYOPS</span>
      </Link>
      <nav className="product-nav" aria-label="Product navigation">
        <Link href="/" className="product-nav-link">
          <Scale size={15} />
          Reconcile
        </Link>
        <Link
          href="/source-ingestion"
          className={`product-nav-link ${active === "sources" ? "active" : ""}`}
        >
          <RadioTower size={15} />
          Sources
        </Link>
        <Link
          href="/settlements"
          className={`product-nav-link ${active === "settlements" ? "active" : ""}`}
        >
          <Banknote size={15} />
          Settlements
        </Link>
        <Link
          href="/settlement-imports"
          className={`product-nav-link ${active === "imports" ? "active" : ""}`}
        >
          <FileText size={15} />
          Imports
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
        <SecondaryNavMenu links={secondaryLinks} activeKey={active} />
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

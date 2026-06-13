import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await auth()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <section className="login-story">
        <Link className="brand" href="/">
          <span className="brand-mark">P</span>
          <span>PAYOPS<small>COPILOT</small></span>
        </Link>
        <div>
          <p className="eyebrow">SECURE OPERATIONS WORKSPACE</p>
          <h1>Every payment decision needs an owner.</h1>
          <p>Sign in to a role-based workspace with organization-scoped data and a permanent audit trail.</p>
        </div>
      </section>
      <section className="login-panel">
        <form
          action={async (formData) => {
            "use server";
            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: "/",
            });
          }}
        >
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to PayOps</h2>
          {error && <div className="error-banner">Invalid email or password.</div>}
          <label>EMAIL<input name="email" type="email" required defaultValue="admin@payops.local" /></label>
          <label>PASSWORD<input name="password" type="password" required defaultValue="PayOpsDemo123!" /></label>
          <button className="primary-button" type="submit">Sign in</button>
          <aside>
            <strong>Demo accounts</strong>
            <span>admin@payops.local</span>
            <span>analyst@payops.local</span>
            <span>viewer@payops.local</span>
            <small>Shared password: PayOpsDemo123!</small>
          </aside>
        </form>
      </section>
    </main>
  );
}

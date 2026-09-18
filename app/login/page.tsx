import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { login } from "./actions";

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
          <span>PAYOPS</span>
        </Link>
        <div>
          <p className="eyebrow">SECURE OPERATIONS WORKSPACE</p>
          <h1>Every payment decision needs an owner.</h1>
          <p>Sign in to a role-based workspace with organization-scoped data and a permanent audit trail.</p>
        </div>
      </section>
      <section className="login-panel">
        <form action={login}>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to PayOps</h2>
          {error && (
            <div className="error-banner" role="alert">
              {error === "credentials" || error === "CredentialsSignin"
                ? "Invalid email or password. Please try again."
                : "Sign-in is temporarily unavailable. Please try again shortly."}
            </div>
          )}
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

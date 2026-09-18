"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export async function login(formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // Auth.js logs the underlying server error. Never expose it to the browser.
    const reason = error.type === "CredentialsSignin" ? "credentials" : "unavailable";
    redirect(`/login?error=${reason}`);
  }
}

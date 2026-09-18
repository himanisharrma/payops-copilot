import { beforeEach, describe, expect, it, vi } from "vitest";
import { CallbackRouteError, CredentialsSignin } from "@auth/core/errors";

const { signIn, redirect } = vi.hoisted(() => ({
  signIn: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next-auth", async () => ({ AuthError: (await import("@auth/core/errors")).AuthError }));
vi.mock("@/auth", () => ({ signIn }));
vi.mock("next/navigation", () => ({ redirect }));
import { login } from "./actions";

beforeEach(() => vi.clearAllMocks());
describe("login action", () => {
  it("returns invalid credentials to the form instead of crashing the page", async () => {
    signIn.mockRejectedValueOnce(new CredentialsSignin());
    await expect(login(new FormData())).rejects.toThrow("redirect:/login?error=credentials");
  });
  it("returns backend authentication failures without exposing server details", async () => {
    signIn.mockRejectedValueOnce(new CallbackRouteError(new Error("private database details")));
    await expect(login(new FormData())).rejects.toThrow("redirect:/login?error=unavailable");
  });
  it("preserves Next.js success redirects and unexpected exceptions", async () => {
    const navigation = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValueOnce(navigation);
    await expect(login(new FormData())).rejects.toBe(navigation);
    expect(redirect).not.toHaveBeenCalled();
  });
  it("passes submitted credentials to Auth.js", async () => {
    const form = new FormData();
    form.set("email", "viewer@example.test");
    form.set("password", "test-password");
    signIn.mockResolvedValueOnce(undefined);
    await login(form);
    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "viewer@example.test", password: "test-password", redirectTo: "/",
    });
  });
});

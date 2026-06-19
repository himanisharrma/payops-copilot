import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

import { AccessError, requireActor } from "./access";
import type { AppRole } from "./access";

function session(role: AppRole) {
  return {
    user: {
      id: `user-${role}`,
      name: `${role} user`,
      email: `${role}@payops.local`,
      role,
      organizationId: "organization-1",
      organizationName: "Test organization",
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

describe("role authorization", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it.each(["admin", "analyst", "viewer"] satisfies AppRole[])(
    "allows %s to read protected organization data",
    async (role) => {
      authMock.mockResolvedValue(session(role));
      await expect(requireActor()).resolves.toMatchObject({
        role,
        organizationId: "organization-1",
      });
    },
  );

  it("allows admins and analysts to mutate but rejects viewers", async () => {
    authMock.mockResolvedValue(session("admin"));
    await expect(requireActor(["admin", "analyst"])).resolves.toMatchObject({
      role: "admin",
    });

    authMock.mockResolvedValue(session("analyst"));
    await expect(requireActor(["admin", "analyst"])).resolves.toMatchObject({
      role: "analyst",
    });

    authMock.mockResolvedValue(session("viewer"));
    await expect(requireActor(["admin", "analyst"])).rejects.toMatchObject<
      Partial<AccessError>
    >({ status: 403 });
  });

  it("keeps audit reads administrator-only", async () => {
    authMock.mockResolvedValue(session("admin"));
    await expect(requireActor(["admin"])).resolves.toMatchObject({
      role: "admin",
    });

    authMock.mockResolvedValue(session("analyst"));
    await expect(requireActor(["admin"])).rejects.toMatchObject<
      Partial<AccessError>
    >({ status: 403 });
  });

  it("rejects missing sessions", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireActor()).rejects.toMatchObject<Partial<AccessError>>({
      status: 401,
    });
  });
});

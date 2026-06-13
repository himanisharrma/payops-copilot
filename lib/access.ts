import { auth } from "@/auth";
import { NextResponse } from "next/server";

export type AppRole = "admin" | "analyst" | "viewer";
export type Actor = {
  id: string;
  name: string;
  role: AppRole;
  organizationId: string;
  organizationName: string;
};

export async function requireActor(
  allowed: AppRole[] = ["admin", "analyst", "viewer"],
): Promise<Actor> {
  const session = await auth();
  if (!session?.user) throw new AccessError("unauthorized", 401);
  if (!allowed.includes(session.user.role)) {
    throw new AccessError("forbidden", 403);
  }
  return {
    id: session.user.id,
    name: session.user.name ?? "Unknown user",
    role: session.user.role,
    organizationId: session.user.organizationId,
    organizationName: session.user.organizationName,
  };
}

export class AccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof AccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

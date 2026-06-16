import { NextResponse } from "next/server";
import { accessErrorResponse } from "@/lib/access";
import { DomainError } from "@/lib/modules/errors";

export function apiErrorResponse(
  error: unknown,
  fallbackMessage: string,
  options: { log?: boolean } = {},
) {
  const accessResponse = accessErrorResponse(error);
  if (accessResponse) return accessResponse;

  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  if (options.log ?? true) console.error(error);
  return NextResponse.json({ error: fallbackMessage }, { status: 503 });
}

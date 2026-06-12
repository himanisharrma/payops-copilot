import { NextResponse } from "next/server";
import { reconcilePayments } from "@/lib/reconciliation";
import type { ReconciliationRequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ReconciliationRequest;

    if (!payload.orders || !payload.gateway || !payload.settlements) {
      return NextResponse.json(
        { error: "Orders, gateway, and settlement records are required." },
        { status: 400 },
      );
    }

    return NextResponse.json(reconcilePayments(payload));
  } catch {
    return NextResponse.json(
      { error: "The uploaded files could not be reconciled." },
      { status: 400 },
    );
  }
}

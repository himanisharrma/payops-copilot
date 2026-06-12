import { NextResponse } from "next/server";
import { databaseHealth } from "@/lib/repository";

export async function GET() {
  try {
    return NextResponse.json({
      status: "ok",
      database: "connected",
      checkedAt: await databaseHealth(),
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "disconnected" },
      { status: 503 },
    );
  }
}

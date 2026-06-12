import { NextResponse } from "next/server";
import { listRuns } from "@/lib/repository";

export async function GET() {
  try {
    return NextResponse.json({ runs: await listRuns() });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Run history is unavailable." },
      { status: 503 },
    );
  }
}

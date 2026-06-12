import { NextResponse } from "next/server";
import { listCases } from "@/lib/repository";

export async function GET() {
  try {
    return NextResponse.json({ cases: await listCases() });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Operations cases are unavailable." },
      { status: 503 },
    );
  }
}

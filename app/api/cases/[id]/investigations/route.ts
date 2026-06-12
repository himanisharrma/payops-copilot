import { NextResponse } from "next/server";
import { investigateCase } from "@/lib/ai-investigator";
import {
  getCase,
  saveInvestigation,
} from "@/lib/repository";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const paymentCase = await getCase(id);
    if (!paymentCase) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const result = await investigateCase(paymentCase);
    await saveInvestigation(id, result.analysis, result);
    return NextResponse.json(
      { case: await getCase(id) },
      { status: 201 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "The investigation could not be generated." },
      { status: 503 },
    );
  }
}

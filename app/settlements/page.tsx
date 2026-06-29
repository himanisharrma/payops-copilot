import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import {
  MerchantSettlementStatements,
  type MerchantSettlementFilters,
  type MerchantSettlementStatement,
} from "@/components/merchant-settlement-statements";
import {
  getMerchantSettlement,
  loadMerchantSettlementWorkspace,
} from "@/lib/modules/merchant-settlements/service";
import type { MerchantSettlementDetail } from "@/lib/modules/merchant-settlements/types";

const providerLabels: Record<string, string> = {
  generic: "Generic CSV",
  razorpay_demo: "Razorpay Demo",
  cashfree_demo: "Cashfree Demo",
  payu_demo: "PayU Demo",
};

const rangeDays: Record<MerchantSettlementFilters["range"], number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function readString(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function parseFilters(
  params: Record<string, string | string[] | undefined>,
): MerchantSettlementFilters {
  const requestedRange = readString(params, "range");
  const range: MerchantSettlementFilters["range"] =
    requestedRange === "7d" || requestedRange === "90d"
      ? requestedRange
      : "30d";
  return {
    range,
    date: readString(params, "date"),
    merchant: readString(params, "merchant") || "all",
    provider: readString(params, "provider") || "all",
    status: readString(params, "status") || "all",
    utrState: readString(params, "utrState") || "all",
    statementId: readString(params, "statementId"),
  };
}

function asDateOnly(value: string | null) {
  return value?.slice(0, 10) ?? null;
}

function applyRange(
  statements: MerchantSettlementStatement[],
  range: MerchantSettlementFilters["range"],
) {
  const end = Date.now();
  const start = end - rangeDays[range] * 24 * 60 * 60 * 1000;
  return statements.filter((statement) => {
    const date = new Date(`${statement.statementDate}T00:00:00+05:30`).getTime();
    return date >= start && date <= end;
  });
}

function deductionLabel(type: MerchantSettlementDetail["deductions"][number]["deductionType"]) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapStatement(detail: MerchantSettlementDetail): MerchantSettlementStatement {
  const bankCredit = detail.bankCredits[0] ?? null;
  return {
    id: detail.id,
    merchantAccountId: detail.merchant.id,
    merchantName: detail.merchant.name,
    merchantCode: detail.merchant.reference,
    provider: detail.providerId,
    providerLabel: providerLabels[detail.providerId] ?? detail.providerId,
    batchId: detail.statementReference,
    periodLabel: `${asDateOnly(detail.expectedSettlementAt) ?? "Synthetic"} settlement window`,
    statementDate: asDateOnly(detail.expectedSettlementAt) ?? "",
    expectedSettlementDate: asDateOnly(detail.expectedSettlementAt) ?? "",
    actualSettlementDate: asDateOnly(detail.actualSettlementAt),
    status: detail.status,
    utrState: detail.utrMatchStatus,
    utr: detail.utr,
    bankCreditRef: bankCredit?.bankReference ?? null,
    bankCreditMatchedAt: asDateOnly(bankCredit?.creditedAt ?? null),
    grossAmount: detail.grossAmount,
    deductionsTotal: detail.deductionAmount,
    netSettlement: detail.netAmount,
    lineItemCount: detail.lineCount,
    linkedCaseIds: detail.caseLinks.map((link) => link.caseId),
    deductions: detail.deductions.map((deduction) => ({
      label: deductionLabel(deduction.deductionType),
      amount: deduction.amount,
      evidence: deduction.description,
      kind: deduction.deductionType,
    })),
    evidence: [
      {
        source: "Settlement classification",
        hash: `synthetic:${detail.statementReference}`,
        note:
          typeof detail.classificationEvidence.reason === "string"
            ? detail.classificationEvidence.reason
            : "Deterministic synthetic settlement classification.",
      },
      ...detail.bankCredits.map((credit) => ({
        source: "Bank credit mapping",
        hash: `synthetic:${credit.bankReference}`,
        note: `${credit.matchStatus} · UTR ${credit.utr} · amount ${credit.amount}`,
      })),
      ...detail.events.slice(0, 2).map((event) => ({
        source: event.eventType,
        hash: `synthetic:${event.id}`,
        note: `Recorded by ${event.actorName} at ${event.createdAt.slice(0, 10)}.`,
      })),
    ],
  };
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const resolved = await searchParams;
  const filters = parseFilters(resolved);
  const backendFilters = new URLSearchParams();
  if (filters.provider !== "all") backendFilters.set("provider", filters.provider);
  const workspace = await loadMerchantSettlementWorkspace(
    session.user.organizationId,
    backendFilters,
  );
  const details = (
    await Promise.all(
      workspace.settlements.map((settlement) =>
        getMerchantSettlement(settlement.id, session.user.organizationId),
      ),
    )
  ).filter((item): item is MerchantSettlementDetail => item !== null);
  const statements = applyRange(details.map(mapStatement), filters.range);

  return (
    <main className="shell">
      <AppHeader active="settlements" />
      <MerchantSettlementStatements
        workspace={{
          filters,
          statements,
          options: {
            merchants: [...new Set(details.map((item) => item.merchant.name))],
            providers: Object.entries(providerLabels).map(([value, label]) => ({
              value,
              label,
            })),
          },
        }}
      />
      <section className="settlement-import-crosslink">
        <div>
          <span>NEXT CONTROL</span>
          <h2>Compare provider statements before they become truth.</h2>
          <p>
            Open the Statement Import desk to inspect staged CSV rows, UTR and
            deduction exceptions, linked cases, and adjustment proposals.
          </p>
        </div>
        <a href="/settlement-imports">Open statement imports</a>
      </section>
    </main>
  );
}

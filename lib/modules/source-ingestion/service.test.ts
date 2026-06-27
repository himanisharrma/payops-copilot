import { describe, expect, it } from "vitest";
import {
  buildReadinessSummary,
  classifyArrival,
  profileSourceCsv,
} from "@/lib/modules/source-ingestion/service";
import type { SourceIngestionWorkspace } from "@/lib/modules/source-ingestion/types";

describe("source ingestion control plane", () => {
  it("profiles CSV headers, row counts, totals, and missing required fields", () => {
    const profile = profileSourceCsv(
      "statement_reference,order_id,net_amount\nSTM-1,ORD-1,100.50\nSTM-1,ORD-2,99.50",
      "settlement_statement",
    );

    expect(profile.rowCount).toBe(2);
    expect(profile.amountTotals.net_amount).toBe(200);
    expect(profile.missingHeaders).toEqual(["utr"]);
    expect(profile.diagnostics[0]).toMatchObject({
      code: "missing_required_column",
    });
  });

  it("classifies duplicate, empty, malformed, partial, revised, late, and on-time arrivals", () => {
    const base = {
      duplicateArrivalId: null,
      latestAcceptedHash: null,
      sourceRowCount: 2,
      missingHeaders: [],
      receivedAt: "2026-06-26T08:30:00.000Z",
      expectedArrivalAt: "2026-06-26T09:00:00.000Z",
      graceMinutes: 60,
    };

    expect(classifyArrival({ ...base, duplicateArrivalId: "same" })).toBe("duplicate");
    expect(classifyArrival({ ...base, sourceRowCount: 0 })).toBe("empty_file");
    expect(classifyArrival({ ...base, missingHeaders: ["utr"] })).toBe("schema_failed");
    expect(classifyArrival({ ...base, sourceRowCount: 1 })).toBe("partial");
    expect(classifyArrival({ ...base, latestAcceptedHash: "old" })).toBe("revised");
    expect(
      classifyArrival({
        ...base,
        receivedAt: "2026-06-26T11:00:00.000Z",
      }),
    ).toBe("late");
    expect(classifyArrival(base)).toBe("on_time");
  });

  it("blocks readiness until required sources are accepted", () => {
    const expectations: SourceIngestionWorkspace["expectations"] = [
      {
        id: "expected-bank",
        sourceId: "bank",
        sourceKey: "bank",
        displayName: "Bank statement",
        providerId: "bank_demo",
        sourceKind: "bank_statement",
        transportType: "manual_upload",
        ownerTeam: "Treasury",
        businessDate: "2026-06-26",
        expectedArrivalAt: "2026-06-26T09:00:00.000Z",
        graceMinutes: 60,
        requiredForClose: true,
        expectedFilenamePattern: "*.csv",
        status: "expected",
        latestArrival: null,
      },
      {
        id: "expected-chargebacks",
        sourceId: "chargebacks",
        sourceKey: "chargebacks",
        displayName: "Chargebacks",
        providerId: "paytm_demo",
        sourceKind: "chargebacks_report",
        transportType: "email_demo",
        ownerTeam: "Risk",
        businessDate: "2026-06-26",
        expectedArrivalAt: "2026-06-26T09:00:00.000Z",
        graceMinutes: 60,
        requiredForClose: false,
        expectedFilenamePattern: "*.csv",
        status: "arrived",
        latestArrival: {
          id: "arrival",
          expectationId: "expected-chargebacks",
          sourceId: "chargebacks",
          fileName: "bad.csv",
          fileHash: "a".repeat(64),
          sourceRowCount: 1,
          acceptedRowCount: 0,
          rejectedRowCount: 1,
          receivedAt: "2026-06-26T08:00:00.000Z",
          supersedesArrivalId: null,
          classification: "schema_failed",
          validationStatus: "needs_review",
          downstreamWorkflow: "manual_review",
          linkedReconciliationRunId: null,
          linkedSettlementImportId: null,
          evidence: {},
          review: null,
        },
      },
    ];

    expect(buildReadinessSummary("2026-06-26", expectations)).toMatchObject({
      verdict: "blocked",
      blockingFiles: 1,
      optionalWarnings: 1,
      quarantinedFiles: 1,
    });
  });
});

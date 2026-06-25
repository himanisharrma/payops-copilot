import { describe, expect, it } from "vitest";
import {
  metricChange,
  operationsDrilldown,
  parseInsightsFilters,
  parseOperationsFilters,
  rangeDays,
} from "@/lib/insights";

describe("operations intelligence policy", () => {
  it("parses supported filters and defaults invalid values", () => {
    expect(
      parseInsightsFilters(
        new URLSearchParams(
          "range=90d&provider=razorpay_demo&paymentMode=UPI&priority=high",
        ),
      ),
    ).toEqual({
      range: "90d",
      provider: "razorpay_demo",
      paymentMode: "UPI",
      priority: "high",
    });
    expect(
      parseInsightsFilters(
        new URLSearchParams("range=365d&provider=live&priority=urgent"),
      ),
    ).toEqual({
      range: "30d",
      provider: "all",
      paymentMode: "all",
      priority: "all",
    });
  });

  it("calculates period length and safe previous-period changes", () => {
    expect(rangeDays("30d")).toBe(30);
    expect(metricChange(120, 100)).toBe(20);
    expect(metricChange(50, 0)).toBeNull();
    expect(metricChange(null, 10)).toBeNull();
  });

  it("creates stable operations drill-down URLs", () => {
    expect(
      operationsDrilldown({
        exception: "amount_mismatch",
        provider: "payu_demo",
        priority: "all",
      }),
    ).toBe("/operations?exception=amount_mismatch&provider=payu_demo");
  });

  it("parses shareable operations filters", () => {
    expect(
      parseOperationsFilters(
        new URLSearchParams(
          "status=open&sla=overdue&exception=duplicate&owner=unassigned&age=over_3d&settlementStatus=overdue&settlementCycle=T%2B2&expectedDate=past_due&daysOverdue=3d_7d&caseId=case-1",
        ),
      ),
    ).toMatchObject({
      status: "open",
      sla: "overdue",
      exception: "duplicate",
      owner: "unassigned",
      age: "over_3d",
      settlementStatus: "overdue",
      settlementCycle: "T+2",
      expectedDate: "past_due",
      daysOverdue: "3d_7d",
      caseId: "case-1",
    });
  });
});

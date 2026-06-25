import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  businessDaysBetween,
  indiaDateParts,
  isBusinessDay,
  nextBusinessDay,
} from "./settlement-calendar";

describe("fictional India settlement calendar", () => {
  it("uses IST for instant-to-business-date conversion", () => {
    expect(indiaDateParts("2026-06-19T20:00:00.000Z")).toMatchObject({
      date: "2026-06-20",
      hour: 1,
      minute: 30,
    });
  });

  it("skips weekends", () => {
    expect(nextBusinessDay("2026-06-19")).toEqual({
      date: "2026-06-22",
      skippedDates: ["2026-06-20", "2026-06-21"],
    });
    expect(addBusinessDays("2026-06-19", 1)).toEqual({
      date: "2026-06-22",
      skippedDates: ["2026-06-20", "2026-06-21"],
    });
  });

  it("skips clearly synthetic closures and consecutive non-business days", () => {
    expect(isBusinessDay("2026-08-17")).toBe(false);
    expect(addBusinessDays("2026-08-14", 1)).toEqual({
      date: "2026-08-18",
      skippedDates: ["2026-08-15", "2026-08-16", "2026-08-17"],
    });
  });

  it("counts business days between date boundaries", () => {
    expect(businessDaysBetween("2026-08-14", "2026-08-18")).toBe(1);
    expect(businessDaysBetween("2026-08-18", "2026-08-14")).toBe(0);
  });
});

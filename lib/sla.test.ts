import { describe, expect, it } from "vitest";
import { calculateDueAt, formatSlaDistance, getSlaStatus } from "./sla";

describe("SLA policy", () => {
  it("sets deadlines from case priority", () => {
    const createdAt = "2026-06-14T00:00:00.000Z";

    expect(calculateDueAt(createdAt, "high").toISOString()).toBe(
      "2026-06-14T04:00:00.000Z",
    );
    expect(calculateDueAt(createdAt, "medium").toISOString()).toBe(
      "2026-06-15T00:00:00.000Z",
    );
    expect(calculateDueAt(createdAt, "low").toISOString()).toBe(
      "2026-06-17T00:00:00.000Z",
    );
  });

  it("classifies active and resolved cases against the deadline", () => {
    const common = {
      createdAt: "2026-06-14T00:00:00.000Z",
      dueAt: "2026-06-14T04:00:00.000Z",
      priority: "high" as const,
    };

    expect(
      getSlaStatus({
        ...common,
        status: "open",
        now: "2026-06-14T01:00:00.000Z",
      }),
    ).toBe("on_track");
    expect(
      getSlaStatus({
        ...common,
        status: "investigating",
        now: "2026-06-14T03:30:00.000Z",
      }),
    ).toBe("at_risk");
    expect(
      getSlaStatus({
        ...common,
        status: "open",
        now: "2026-06-14T05:00:00.000Z",
      }),
    ).toBe("overdue");
    expect(
      getSlaStatus({
        ...common,
        status: "resolved",
        resolvedAt: "2026-06-14T03:00:00.000Z",
      }),
    ).toBe("met");
    expect(
      getSlaStatus({
        ...common,
        status: "resolved",
        resolvedAt: "2026-06-14T05:00:00.000Z",
      }),
    ).toBe("breached");
  });

  it("formats human-readable time remaining", () => {
    expect(
      formatSlaDistance(
        "2026-06-14T05:30:00.000Z",
        "2026-06-14T04:00:00.000Z",
      ),
    ).toBe("1h 30m remaining");
    expect(
      formatSlaDistance(
        "2026-06-14T03:45:00.000Z",
        "2026-06-14T04:00:00.000Z",
      ),
    ).toBe("15m overdue");
  });
});

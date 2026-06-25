import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getInsightsDashboard } from "@/lib/modules/insights/repository";

const organizationsToDelete: string[] = [];

async function createInsightsTenant(label: string) {
  const slug = `insights-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [`Insights ${label}`, slug],
  );
  const organizationId = organization.rows[0].id;
  organizationsToDelete.push(organizationId);
  const now = Date.now();

  async function addRun(input: {
    providerId: "generic" | "razorpay_demo";
    createdAt: Date;
    items: Array<{
      status:
        | "matched"
        | "amount_mismatch"
        | "missing_settlement"
        | "pending";
      amount: number;
      paymentMode: string;
      priority?: "low" | "medium" | "high";
      owner?: string | null;
      resolvedAfterHours?: number;
      dueAfterHours?: number;
    }>;
  }) {
    const matched = input.items.filter((item) => item.status === "matched");
    const run = await db.query<{ id: string }>(
      `INSERT INTO reconciliation_runs (
         organization_id, name, source_type, provider_id, total_orders,
         processed_value, matched_value, unmatched_value, matched_count,
         exception_count, match_rate, source_files, created_at
       ) VALUES ($1,'Integration insights','demo',$2,$3,$4,$5,$6,$7,$8,$9,'{}',$10)
       RETURNING id`,
      [
        organizationId,
        input.providerId,
        input.items.length,
        input.items.reduce((sum, item) => sum + item.amount, 0),
        matched.reduce((sum, item) => sum + item.amount, 0),
        input.items
          .filter((item) => item.status !== "matched")
          .reduce((sum, item) => sum + item.amount, 0),
        matched.length,
        input.items.filter(
          (item) => !["matched", "pending"].includes(item.status),
        ).length,
        (matched.length / input.items.length) * 100,
        input.createdAt,
      ],
    );
    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO reconciliation_items (
           organization_id, run_id, order_id, gateway_reference, payment_mode,
           order_amount, variance, reconciliation_status, severity, summary,
           evidence, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Integration item','[]',$10)
         RETURNING id`,
        [
          organizationId,
          run.rows[0].id,
          `${label}-ORDER-${randomUUID()}`,
          `${label}-PAY-${randomUUID()}`,
          item.paymentMode,
          item.amount,
          item.status === "amount_mismatch" ? -50 : 0,
          item.status,
          item.priority ?? "medium",
          input.createdAt,
        ],
      );
      if (!["matched", "pending"].includes(item.status)) {
        const createdAt = input.createdAt;
        const dueAt = new Date(
          createdAt.getTime() + (item.dueAfterHours ?? 24) * 3_600_000,
        );
        const resolvedAt =
          item.resolvedAfterHours === undefined
            ? null
            : new Date(
                createdAt.getTime() +
                  item.resolvedAfterHours * 3_600_000,
              );
        await db.query(
          `INSERT INTO operations_cases (
             organization_id, item_id, run_id, case_status, priority, owner,
             due_at, resolved_at, resolution_reason,
             resolution_evidence_confirmed, resolved_by_name,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
           )`,
          [
            organizationId,
            inserted.rows[0].id,
            run.rows[0].id,
            resolvedAt ? "resolved" : "open",
            item.priority ?? "medium",
            item.owner ?? null,
            dueAt,
            resolvedAt,
            resolvedAt ? "Integration evidence was reviewed." : null,
            Boolean(resolvedAt),
            resolvedAt ? "Integration Admin" : null,
            createdAt,
            resolvedAt ?? createdAt,
          ],
        );
      }
    }
  }

  await addRun({
    providerId: "razorpay_demo",
    createdAt: new Date(now - 2 * 86_400_000),
    items: [
      { status: "matched", amount: 1000, paymentMode: "UPI" },
      {
        status: "amount_mismatch",
        amount: 2000,
        paymentMode: "UPI",
        priority: "high",
        owner: null,
        resolvedAfterHours: 6,
        dueAfterHours: 4,
      },
      {
        status: "missing_settlement",
        amount: 3000,
        paymentMode: "Card",
        priority: "medium",
        owner: "Analyst",
      },
    ],
  });
  await addRun({
    providerId: "generic",
    createdAt: new Date(now - 35 * 86_400_000),
    items: [
      { status: "matched", amount: 500, paymentMode: "UPI" },
      {
        status: "amount_mismatch",
        amount: 700,
        paymentMode: "UPI",
        resolvedAfterHours: 2,
      },
    ],
  });
  return organizationId;
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("operations intelligence aggregates", () => {
  it("calculates period, queue, provider, drill-down, and tenant-safe metrics", async () => {
    const tenantA = await createInsightsTenant("A");
    const tenantB = await createInsightsTenant("B");
    const dashboard = await getInsightsDashboard(tenantA, {
      range: "30d",
      provider: "all",
      paymentMode: "all",
      priority: "all",
    });

    expect(dashboard.hasData).toBe(true);
    expect(dashboard.kpis.processedValue.value).toBe(6000);
    expect(dashboard.kpis.processedValue.previousValue).toBe(1200);
    expect(dashboard.kpis.matchRate.value).toBeCloseTo(33.3, 1);
    expect(dashboard.kpis.actionableExceptions.value).toBe(2);
    expect(dashboard.kpis.medianResolutionHours.value).toBe(6);
    expect(dashboard.currentQueue.active).toBe(1);
    expect(dashboard.currentQueue.unassigned).toBe(0);
    expect(dashboard.periodOutcomes).toEqual({
      resolvedCases: 1,
      slaBreachRate: 100,
    });
    expect(
      dashboard.exceptionMix.map((item) => item.status),
    ).toEqual(expect.arrayContaining(["amount_mismatch", "missing_settlement"]));
    expect(dashboard.providerPerformance).toEqual([
      expect.objectContaining({
        providerId: "razorpay_demo",
        totalOrders: 3,
      }),
    ]);
    expect(
      dashboard.dailyTrend.reduce((sum, day) => sum + day.orders, 0),
    ).toBe(3);

    const filtered = await getInsightsDashboard(tenantA, {
      range: "30d",
      provider: "razorpay_demo",
      paymentMode: "UPI",
      priority: "all",
    });
    expect(filtered.kpis.processedValue.value).toBe(3000);
    expect(filtered.options.paymentModes).toEqual(
      expect.arrayContaining(["UPI", "Card"]),
    );
    expect(filtered.aiGovernance.approvalRate).toBeNull();
    expect(filtered.inboundEvidence).toEqual([]);

    const other = await getInsightsDashboard(tenantB, {
      range: "30d",
      provider: "all",
      paymentMode: "all",
      priority: "all",
    });
    expect(other.kpis.processedValue.value).toBe(6000);
    expect(other.providerPerformance).toHaveLength(1);

    const emptyOrganization = await db.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
      ["Empty insights", `empty-${randomUUID()}`],
    );
    organizationsToDelete.push(emptyOrganization.rows[0].id);
    const empty = await getInsightsDashboard(emptyOrganization.rows[0].id, {
      range: "30d",
      provider: "all",
      paymentMode: "all",
      priority: "all",
    });
    expect(empty.hasData).toBe(false);
    expect(empty.kpis.matchRate.value).toBeNull();
  });
});

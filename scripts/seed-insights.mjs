import { createHash } from "node:crypto";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";
const client = new pg.Client({ connectionString: databaseUrl });
const marker = "operations-insights-v1";
const providers = [
  "generic",
  "razorpay_demo",
  "cashfree_demo",
  "payu_demo",
];
const paymentModes = ["UPI", "Card", "Netbanking", "Wallet"];
const statuses = [
  "matched",
  "matched",
  "matched",
  "amount_mismatch",
  "missing_settlement",
  "gateway_missing",
  "duplicate",
  "pending",
];
const policyVersion = "settlement-policy-v1";
const calendarVersion = "india-demo-calendar-v1";
const cycles = ["T+0", "T+1", "T+2"];

function ago(days, hours = 0) {
  return new Date(Date.now() - (days * 24 + hours) * 3_600_000);
}

function businessDateFromNow(dayOffset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayOffset);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + (dayOffset < 0 ? -1 : 1));
  }
  date.setUTCHours(12, 30, 0, 0);
  return date;
}

function subtractBusinessDays(date, count) {
  const result = new Date(date);
  for (let remaining = count; remaining > 0; ) {
    result.setUTCDate(result.getUTCDate() - 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) remaining -= 1;
  }
  result.setUTCHours(4, 30, 0, 0);
  return result;
}

function hashEvidence(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

await client.connect();
await client.query("BEGIN");
try {
  const organization = await client.query(
    "SELECT id FROM organizations WHERE slug = 'payops-portfolio'",
  );
  const organizationId = organization.rows[0]?.id;
  if (!organizationId) throw new Error("Run npm run db:seed after migrations.");
  const users = await client.query(
    `SELECT id, name, role FROM users
     WHERE organization_id = $1 AND role IN ('admin', 'analyst')`,
    [organizationId],
  );
  const admin = users.rows.find((user) => user.role === "admin");
  const analyst = users.rows.find((user) => user.role === "analyst") ?? admin;
  if (!admin || !analyst) throw new Error("Seed demo users first.");

  await client.query(
    `UPDATE reconciliation_close_periods period
     SET active_version_id = NULL
     WHERE organization_id = $1
       AND EXISTS (
         SELECT 1 FROM reconciliation_close_versions version
         WHERE version.id = period.active_version_id
           AND version.snapshot->>'seedMarker' = $2
       )`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM reconciliation_close_periods period
     WHERE organization_id = $1
       AND EXISTS (
         SELECT 1 FROM reconciliation_close_versions version
         WHERE version.period_id = period.id
           AND version.snapshot->>'seedMarker' = $2
       )`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM provider_webhook_attempts
     WHERE organization_id = $1
       AND external_event_id LIKE 'insights-attempt-%'`,
    [organizationId],
  );
  await client.query(
    `DELETE FROM provider_webhook_deliveries
     WHERE organization_id = $1
       AND external_event_id LIKE 'insights-seed-%'`,
    [organizationId],
  );
  await client.query(
    `DELETE FROM reconciliation_runs
     WHERE organization_id = $1
       AND source_files->>'seed' = $2`,
    [organizationId, marker],
  );

  const seededItems = [];
  for (let runIndex = 0; runIndex < 18; runIndex += 1) {
    const createdAt = ago(runIndex * 2 + 1, runIndex % 6);
    const providerId = providers[runIndex % providers.length];
    const runItems = Array.from({ length: 8 }, (_, itemIndex) => {
      const status = statuses[(runIndex + itemIndex) % statuses.length];
      const amount = 1200 + runIndex * 175 + itemIndex * 430;
      const variance =
        status === "amount_mismatch"
          ? -75 - itemIndex * 5
          : status === "missing_settlement"
            ? amount
            : status === "duplicate"
              ? amount
              : 0;
      return {
        status,
        amount,
        variance,
        paymentMode: paymentModes[(runIndex + itemIndex) % paymentModes.length],
      };
    });
    const processedValue = runItems.reduce(
      (total, item) => total + item.amount,
      0,
    );
    const matchedCount = runItems.filter(
      (item) => item.status === "matched",
    ).length;
    const exceptionCount = runItems.filter(
      (item) => !["matched", "pending"].includes(item.status),
    ).length;
    const run = await client.query(
      `INSERT INTO reconciliation_runs (
         organization_id, name, source_type, provider_id, status,
         total_orders, processed_value, matched_value, unmatched_value,
         matched_count, exception_count, match_rate, source_files, created_at
       ) VALUES (
         $1,$2,'demo',$3,'completed',$4,$5,$6,$7,$8,$9,$10,$11,$12
       ) RETURNING id`,
      [
        organizationId,
        `Insights synthetic day ${String(runIndex + 1).padStart(2, "0")}`,
        providerId,
        runItems.length,
        processedValue,
        runItems
          .filter((item) => item.status === "matched")
          .reduce((total, item) => total + item.amount, 0),
        runItems
          .filter((item) => item.status !== "matched")
          .reduce((total, item) => total + item.amount, 0),
        matchedCount,
        exceptionCount,
        Number(((matchedCount / runItems.length) * 100).toFixed(2)),
        JSON.stringify({ seed: marker, fictional: true }),
        createdAt,
      ],
    );

    for (let itemIndex = 0; itemIndex < runItems.length; itemIndex += 1) {
      const item = runItems[itemIndex];
      const orderId = `INS-${String(runIndex + 1).padStart(2, "0")}-${String(
        itemIndex + 1,
      ).padStart(2, "0")}`;
      const paymentReference = `PAY-${orderId}`;
      const settlementCycle = cycles[(runIndex + itemIndex) % cycles.length];
      let transactionAt = new Date(createdAt.getTime() - 3_600_000);
      const cycleDays = Number(settlementCycle.slice(-1));
      let expectedSettlementAt = new Date(
        transactionAt.getTime() + cycleDays * 86_400_000,
      );
      if (item.status === "missing_settlement") {
        const missingState = (runIndex + itemIndex) % 3;
        expectedSettlementAt =
          missingState === 0
            ? businessDateFromNow(1)
            : missingState === 1
              ? businessDateFromNow(0)
              : businessDateFromNow(-2);
        transactionAt = subtractBusinessDays(expectedSettlementAt, cycleDays);
      }
      const settlementRecordedAt = ["matched", "amount_mismatch"].includes(
        item.status,
      )
        ? new Date(
            expectedSettlementAt.getTime() +
              ((runIndex + itemIndex) % 4 === 0 ? 6 : -3) * 3_600_000,
          )
        : null;
      const timingEligible = !["gateway_missing", "pending"].includes(
        item.status,
      );
      const timingEvidence = {
        providerId,
        paymentMode: item.paymentMode,
        cycle: settlementCycle,
        transactionAt: transactionAt.toISOString(),
        transactionTimestampSource: "gateway_capture",
        captureCutoff: "15:00",
        afterCaptureCutoff: false,
        cycleAnchorDate: transactionAt.toISOString().slice(0, 10),
        skippedNonBusinessDates: [],
        expectedSettlementAt: expectedSettlementAt.toISOString(),
        settlementCutoff: "18:00",
        timezone: "Asia/Kolkata",
        policyVersion,
        calendarVersion,
        usedFallbackPolicy: false,
      };
      const summary = {
        matched: "Order, gateway, and settlement evidence agree.",
        amount_mismatch:
          "Bank settlement differs from gateway amount less fees and tax.",
        missing_settlement:
          "Captured gateway payment is missing from the settlement report.",
        gateway_missing:
          "Internal order is missing from the gateway report.",
        duplicate: "Multiple gateway rows use the same merchant order ID.",
        pending: "Gateway payment remains pending and is not yet settleable.",
      }[item.status];
      const insertedItem = await client.query(
        `INSERT INTO reconciliation_items (
           organization_id, run_id, order_id, gateway_reference, payment_mode,
           order_amount, gateway_amount, settled_amount, expected_net,
           variance, reconciliation_status, severity, summary, evidence,
           transaction_at, transaction_timestamp_source,
           settlement_recorded_at, settlement_cycle, expected_settlement_at,
           settlement_policy_version, settlement_calendar_version,
           settlement_timing_evidence, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
           $15,$16,$17,$18,$19,$20,$21,$22,$23
         ) RETURNING id`,
        [
          organizationId,
          run.rows[0].id,
          orderId,
          paymentReference,
          item.paymentMode,
          item.amount,
          item.status === "gateway_missing" ? null : item.amount,
          ["missing_settlement", "gateway_missing", "pending"].includes(
            item.status,
          )
            ? null
            : item.amount + item.variance,
          item.status === "gateway_missing" ? null : item.amount,
          item.variance,
          item.status,
          ["duplicate", "gateway_missing"].includes(item.status)
            ? "high"
            : item.status === "amount_mismatch"
              ? "medium"
              : "low",
          summary,
          JSON.stringify([
            `Synthetic ${providerId} evidence`,
            `Payment mode: ${item.paymentMode}`,
          ]),
          timingEligible ? transactionAt : null,
          timingEligible ? "gateway_capture" : null,
          settlementRecordedAt,
          timingEligible ? settlementCycle : null,
          timingEligible ? expectedSettlementAt : null,
          timingEligible ? policyVersion : null,
          timingEligible ? calendarVersion : null,
          timingEligible ? JSON.stringify(timingEvidence) : null,
          createdAt,
        ],
      );
      const evidence = {
        orderId,
        amount: item.amount,
        paymentReference,
        fictional: true,
      };
      await client.query(
        `INSERT INTO reconciliation_source_evidence (
           organization_id, run_id, item_id, source_type, row_number,
           normalized_values, source_values, integrity_hash, created_at
         ) VALUES ($1,$2,$3,'orders',$4,$5,$5,$6,$7)`,
        [
          organizationId,
          run.rows[0].id,
          insertedItem.rows[0].id,
          itemIndex + 1,
          JSON.stringify(evidence),
          hashEvidence(evidence),
          createdAt,
        ],
      );
      seededItems.push({
        ...item,
        id: insertedItem.rows[0].id,
        runId: run.rows[0].id,
        orderId,
        paymentReference,
        providerId,
        createdAt,
        summary,
        expectedSettlementAt: timingEligible ? expectedSettlementAt : null,
        settlementRecordedAt,
      });
    }
  }

  const actionable = seededItems.filter(
    (item) =>
      !["matched", "pending"].includes(item.status) &&
      (item.status !== "missing_settlement" ||
        item.expectedSettlementAt.getTime() < Date.now()),
  );
  for (let index = 0; index < actionable.length; index += 1) {
    const item = actionable[index];
    const priority = ["high", "medium", "low"][index % 3];
    const state = index % 6;
    const resolved = state === 3 || state === 4;
    const breached = state === 4;
    const investigating = state === 1 || state === 5;
    const unassigned = state === 0 || state === 4;
    const dueAt =
      state === 2
        ? new Date(Date.now() + 30 * 60_000)
        : new Date(
            item.createdAt.getTime() +
              { high: 4, medium: 24, low: 72 }[priority] * 3_600_000,
          );
    const resolvedAt = resolved
      ? new Date(
          dueAt.getTime() + (breached ? 4 : -2) * 3_600_000,
        )
      : null;
    const paymentCase = await client.query(
      `INSERT INTO operations_cases (
         organization_id, item_id, run_id, case_status, priority, owner,
         notes, due_at, resolved_at, resolution_reason,
         resolution_evidence_confirmed, resolved_by_user_id, resolved_by_name,
         case_origin, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) RETURNING id`,
      [
        organizationId,
        item.id,
        item.runId,
        resolved ? "resolved" : investigating ? "investigating" : "open",
        priority,
        unassigned ? null : analyst.name,
        investigating
          ? "Synthetic investigation is awaiting provider confirmation."
          : "",
        dueAt,
        resolvedAt,
        resolved
          ? "Synthetic evidence reviewed and discrepancy documented."
          : null,
        resolved,
        resolved ? admin.id : null,
        resolved ? admin.name : null,
        item.status === "missing_settlement"
          ? "settlement_overdue"
          : "reconciliation_exception",
        item.createdAt,
        resolvedAt ?? item.createdAt,
      ],
    );

    if (index % 2 === 0) {
      const approval =
        index % 4 === 0 ? "approved" : index % 4 === 2 ? "rejected" : "pending";
      const rating =
        approval === "approved"
          ? "helpful"
          : approval === "rejected"
            ? "not_helpful"
            : null;
      await client.query(
        `INSERT INTO ai_investigations (
           case_id, provider, model, prompt_version, likely_cause, confidence,
           supporting_evidence, recommended_actions, provider_message,
           limitations, approval_status, feedback_rating, feedback_notes,
           approved_at, created_at, updated_at
         ) VALUES (
           $1,'deterministic','evidence-rules-v1','payment-investigation-v1',
           $2,'medium',$3,$4,$5,$6,$7,$8,'Synthetic reviewer outcome.',
           $9,$10,$10
         )`,
        [
          paymentCase.rows[0].id,
          "The supplied evidence indicates an exception that needs verification.",
          JSON.stringify([item.summary]),
          JSON.stringify([
            "Confirm the settlement cycle.",
            "Record provider confirmation before changing financial records.",
          ]),
          `Please verify ${item.orderId}; no financial action has been taken.`,
          JSON.stringify([
            "Synthetic evidence cannot confirm provider-side events.",
          ]),
          approval,
          rating,
          approval === "approved" ? item.createdAt : null,
          item.createdAt,
        ],
      );
    }
  }

  for (let index = 0; index < 8; index += 1) {
    const item = actionable[index];
    const providerId = ["razorpay_demo", "cashfree_demo", "payu_demo"][
      index % 3
    ];
    const delivery = await client.query(
      `INSERT INTO provider_webhook_deliveries (
         organization_id, provider_id, external_event_id, event_type,
         payload_hash, occurred_at, received_at
       ) VALUES ($1,$2,$3,'payment.captured',$4,$5,$5)
       RETURNING id`,
      [
        organizationId,
        providerId,
        `insights-seed-${index + 1}`,
        hashEvidence({ providerId, orderId: item.orderId }),
        ago(index + 1),
      ],
    );
    const providerEvent = await client.query(
      `INSERT INTO provider_events (
         organization_id, delivery_id, provider_id, event_type, title,
         order_id, payment_reference, status, occurred_at, proves,
         does_not_prove
       ) VALUES (
         $1,$2,$3,'payment_captured','Payment captured',$4,$5,'captured',
         $6,$7,$8
       ) RETURNING id`,
      [
        organizationId,
        delivery.rows[0].id,
        providerId,
        item.orderId,
        item.paymentReference,
        ago(index + 1),
        "Synthetic provider evidence references this payment.",
        "It does not prove that bank settlement has arrived.",
      ],
    );
    const outcome =
      index === 5 ? "duplicate" : index === 6 ? "rejected" : "accepted";
    const keyState = index === 2 || index === 5 ? "previous" : "active";
    await client.query(
      `INSERT INTO provider_webhook_attempts (
         organization_id, provider_id, external_event_id, event_type,
         payload_hash, signature_version, signature_key_id, key_state,
         outcome, http_status, failure_code, matched_records,
         provider_event_id, processing_ms, received_at
       ) VALUES (
         $1,$2,$3,'payment.captured',$4,'provider-v2',$5,$6,$7,$8,$9,$10,
         $11,$12,$13
       )`,
      [
        organizationId,
        providerId,
        `insights-attempt-${index + 1}`,
        hashEvidence({ providerId, attempt: index + 1 }),
        `${providerId}-key-${keyState}`,
        keyState,
        outcome,
        outcome === "accepted" ? 202 : outcome === "duplicate" ? 200 : 401,
        outcome === "rejected" ? "signature_rejected" : null,
        outcome === "accepted" ? 1 : 0,
        outcome === "rejected" ? null : providerEvent.rows[0].id,
        18 + index * 7,
        ago(index + 1),
      ],
    );
  }

  await client.query(
    `INSERT INTO provider_webhook_attempts (
       organization_id, provider_id, external_event_id, event_type,
       payload_hash, signature_version, signature_key_id, key_state,
       outcome, http_status, failure_code, processing_ms, received_at
     ) VALUES
       ($1,'cashfree_demo','insights-attempt-9','payment.captured',$2,
        'provider-v2','cf-key-active','active','rejected',401,
        'stale_timestamp',12,$3),
       ($1,'payu_demo','insights-attempt-10','settlement.processed',$4,
        'provider-v2','payu-key-active','active','conflict',409,
        'event_id_conflict',21,$5),
       ($1,'razorpay_demo','insights-attempt-11',NULL,$6,
        'provider-v2','rzp-key-active','active','rejected',400,
        'invalid_json',9,$7),
       ($1,'payu_demo','insights-attempt-12','refund.created',$8,
        'provider-v2','payu-key-active','active','failed',503,
        'processing_failure',85,$9)`,
    [
      organizationId,
      hashEvidence({ attempt: 9 }),
      ago(2),
      hashEvidence({ attempt: 10 }),
      ago(3),
      hashEvidence({ attempt: 11 }),
      ago(4),
      hashEvidence({ attempt: 12 }),
      ago(5),
    ],
  );

  const closeScopes = await client.query(
    `SELECT run.provider_id, item.payment_mode,
       TO_CHAR(
         (run.created_at AT TIME ZONE 'Asia/Kolkata')::date,
         'YYYY-MM-DD'
       ) AS business_date,
       COUNT(item.id)::int AS item_count,
       COALESCE(SUM(item.order_amount), 0)::float8 AS processed_value,
       COALESCE(SUM(
         CASE WHEN item.reconciliation_status = 'matched'
           THEN item.order_amount ELSE 0 END
       ), 0)::float8 AS matched_value,
       COUNT(*) FILTER (
         WHERE item.reconciliation_status NOT IN ('matched', 'pending')
       )::int AS exception_count
     FROM reconciliation_runs run
     JOIN reconciliation_items item
       ON item.run_id = run.id AND item.organization_id = run.organization_id
     WHERE run.organization_id = $1
       AND run.source_files->>'seed' = $2
     GROUP BY run.provider_id, item.payment_mode, business_date
     ORDER BY business_date DESC, run.provider_id, item.payment_mode
     LIMIT 3`,
    [organizationId, marker],
  );
  const closeStates = ["approved", "submitted", "reopened"];
  for (let index = 0; index < closeScopes.rows.length; index += 1) {
    const scope = closeScopes.rows[index];
    const state = closeStates[index];
    const period = await client.query(
      `INSERT INTO reconciliation_close_periods (
         organization_id, business_date, provider_id, payment_mode,
         unresolved_count_threshold, unresolved_amount_threshold, status,
         reopened_by_user_id, reopened_by_name, reopened_reason, reopened_at
       ) VALUES (
         $1,$2,$3,$4,2,5000,$5,
         CASE WHEN $5 = 'reopened' THEN $6::uuid ELSE NULL END,
         CASE WHEN $5 = 'reopened' THEN $7 ELSE NULL END,
         CASE WHEN $5 = 'reopened'
           THEN 'Synthetic late evidence required a corrected close version.'
           ELSE NULL END,
         CASE WHEN $5 = 'reopened' THEN NOW() - INTERVAL '2 hours' ELSE NULL END
       ) RETURNING id`,
      [
        organizationId,
        scope.business_date,
        scope.provider_id,
        scope.payment_mode,
        state,
        admin.id,
        admin.name,
      ],
    );
    const snapshot = {
      seedMarker: marker,
      businessDate: scope.business_date,
      providerId: scope.provider_id,
      paymentMode: scope.payment_mode,
      runCount: 1,
      itemCount: scope.item_count,
      processedValue: scope.processed_value,
      matchedValue: scope.matched_value,
      actionableExceptionCount: scope.exception_count,
      unresolvedCaseCount: 0,
      unresolvedExposure: 0,
      blockingCaseCount: 0,
      unresolvedCountThreshold: 2,
      unresolvedAmountThreshold: 5000,
      ready: true,
      blockers: [],
      unresolvedCases: [],
    };
    const approved = state === "approved" || state === "reopened";
    const version = await client.query(
      `INSERT INTO reconciliation_close_versions (
         organization_id, period_id, version_number, snapshot, snapshot_hash,
         prepared_by_user_id, prepared_by_name, prepared_at,
         approved_by_user_id, approved_by_name, approved_at
       ) VALUES (
         $1,$2,1,$3,$4,$5,$6,NOW() - INTERVAL '4 hours',
         CASE WHEN $7 THEN $8::uuid ELSE NULL END,
         CASE WHEN $7 THEN $9 ELSE NULL END,
         CASE WHEN $7 THEN NOW() - INTERVAL '3 hours' ELSE NULL END
       ) RETURNING id`,
      [
        organizationId,
        period.rows[0].id,
        JSON.stringify(snapshot),
        hashEvidence(snapshot),
        analyst.id,
        analyst.name,
        approved,
        admin.id,
        admin.name,
      ],
    );
    await client.query(
      `UPDATE reconciliation_close_periods
       SET active_version_id = $2
       WHERE id = $1`,
      [period.rows[0].id, version.rows[0].id],
    );
  }

  await client.query("COMMIT");
  console.log(
    `Seeded ${18} runs, ${seededItems.length} items, ${actionable.length} cases, 8 signed evidence records, 12 webhook attempts, and ${closeScopes.rows.length} close controls.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

import { createHash } from "node:crypto";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";
const client = new pg.Client({ connectionString: databaseUrl });

const marker = "merchant-settlements-v1";
const settlementImportMarker = "settlement-import-desk-v1";
const policyVersion = "merchant-statement-demo-policy-v1";
const calendarVersion = "india-demo-calendar-v1";

const providers = ["razorpay_demo", "cashfree_demo", "payu_demo"];

function daysFromNow(days, hours = 0) {
  const date = new Date(Date.now() + (days * 24 + hours) * 3_600_000);
  date.setUTCMinutes(30, 0, 0);
  return date;
}

function hashEvidence(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function money(value) {
  return Number(value.toFixed(2));
}

async function tableExists(tableName) {
  const result = await client.query("SELECT to_regclass($1) AS table_name", [
    tableName,
  ]);
  return Boolean(result.rows[0]?.table_name);
}

function batchStatusFor(line) {
  if (line.scenario.settlementStatus === "scheduled") return "scheduled";
  if (line.scenario.settlementStatus === "held") return "held";
  if (line.scenario.settlementStatus === "failed") return "failed";
  if (
    [
      "partially_credited",
      "credited_missing_utr",
      "duplicate_utr",
      "amount_mismatch",
    ].includes(line.scenario.settlementStatus)
  ) {
    return "partially_credited";
  }
  return "credited";
}

function utrStatusFor(line) {
  if (line.scenario.settlementStatus === "scheduled") return "not_due";
  if (line.scenario.settlementStatus === "held") return "held_settlement";
  if (line.scenario.settlementStatus === "failed") return "retry_exhausted";
  if (line.scenario.settlementStatus === "partially_credited") {
    return "amount_mismatch";
  }
  if (line.scenario.settlementStatus === "credited_missing_utr") {
    return "missing_utr";
  }
  if (line.scenario.settlementStatus === "duplicate_utr") {
    return "duplicate_utr";
  }
  if (line.scenario.settlementStatus === "amount_mismatch") {
    return "amount_mismatch";
  }
  if (line.scenario.settlementStatus === "credited_late") return "delayed_credit";
  return "matched";
}

function lineStatusFor(line) {
  if (line.scenario.settlementStatus === "held") return "held";
  if (line.scenario.settlementStatus === "failed") return "failed";
  if (line.scenario.settlementStatus.includes("chargeback")) return "reversed";
  return "included";
}

function caseLinkTypeFor(line) {
  const utrStatus = utrStatusFor(line);
  if (["missing_utr", "duplicate_utr", "utr_not_found"].includes(utrStatus)) {
    return "utr_exception";
  }
  if (utrStatus === "amount_mismatch") return "amount_exception";
  if (["delayed_credit", "held_settlement", "retry_exhausted"].includes(utrStatus)) {
    return "settlement_delay";
  }
  return "manual_review";
}

function settlementDeductionsFor(line) {
  const deductions = line.scenario.deductions;
  const entries = [
    ["mdr", deductions.mdr, "MDR / commission from synthetic fee schedule", false],
    ["gst", deductions.gst, "GST on synthetic payment fee", false],
    ["refund", deductions.refund, "Forward refund netted against this batch", true],
    [
      "chargeback",
      deductions.chargeback,
      "Forward chargeback netted against this batch",
      true,
    ],
    ["recovery", deductions.recovery, "Synthetic recovery adjustment", false],
    ["adjustment", deductions.adjustment, "Statement adjustment", false],
    ["hold", deductions.hold, "Settlement amount placed on hold", false],
    ["hold_release", deductions.release, "Prior settlement hold released into this batch", false],
  ];
  return entries
    .filter(([, amount]) => amount > 0)
    .map(([deductionType, amount, description, forwardApplied]) => ({
      deductionType,
      direction:
        deductionType === "hold_release"
          ? "release"
          : forwardApplied
            ? "forward_deduction"
            : "current_settlement",
      amount,
      description,
      forwardApplied,
    }));
}

function buildLine({
  slug,
  title,
  providerId,
  paymentMode,
  reconciliationStatus,
  severity,
  gross,
  mdr,
  gst,
  refund = 0,
  chargeback = 0,
  recovery = 0,
  adjustment = 0,
  hold = 0,
  release = 0,
  settledAmount,
  expectedDayOffset,
  actualDayOffset = null,
  utr,
  bankUtr = utr,
  bankCreditAmount = settledAmount,
  settlementStatus,
  caseStatus = null,
  caseOrigin = "reconciliation_exception",
  casePriority = severity,
  caseNotes = "",
}) {
  const transactionAt = daysFromNow(expectedDayOffset - 2, -2);
  const expectedSettlementAt = daysFromNow(expectedDayOffset);
  const settlementRecordedAt =
    actualDayOffset === null ? null : daysFromNow(actualDayOffset, 3);
  const expectedNet = money(
    gross - mdr - gst - refund - chargeback + recovery + adjustment - hold + release,
  );
  const actualSettledAmount =
    settledAmount === null || settledAmount === undefined
      ? null
      : money(settledAmount);
  const variance = money((actualSettledAmount ?? 0) - expectedNet);
  const orderId = `MSS-${slug.toUpperCase().replaceAll("-", "-")}`;
  const gatewayReference = `PG-${orderId}`;
  const settlementBatchId = `STMT-${providerId}-${expectedSettlementAt
    .toISOString()
    .slice(0, 10)}`;
  const scenario = {
    seedMarker: marker,
    scenario: slug,
    title,
    syntheticOnly: true,
    noMoneyMovement: true,
    providerId,
    paymentMode,
    merchantId: "merchant-demo-urbanthreads",
    statementId: `MSS-2026-${slug}`,
    settlementBatchId,
    orderId,
    gatewayReference,
    grossCollected: gross,
    deductions: {
      mdr,
      gst,
      refund,
      chargeback,
      recovery,
      adjustment,
      hold,
      release,
    },
    expectedNet,
    settledAmount: actualSettledAmount,
    variance,
    utr,
    bankUtr,
    bankCreditAmount,
    settlementStatus,
    expectedSettlementAt: expectedSettlementAt.toISOString(),
    settlementRecordedAt: settlementRecordedAt?.toISOString() ?? null,
    ruleEvidence:
      "Synthetic merchant statement line generated to prove settlement-vs-reconciliation scenarios without live provider connectivity.",
  };

  return {
    slug,
    title,
    providerId,
    paymentMode,
    orderId,
    gatewayReference,
    gross,
    expectedNet,
    actualSettledAmount,
    variance,
    reconciliationStatus,
    severity,
    summary: title,
    evidence: [
      `Synthetic merchant settlement scenario: ${title}`,
      `Expected net: INR ${expectedNet}; settled: ${
        actualSettledAmount === null ? "not credited" : `INR ${actualSettledAmount}`
      }`,
      `UTR: ${utr ?? "missing"}`,
    ],
    transactionAt,
    expectedSettlementAt,
    settlementRecordedAt,
    settlementCycle: "T+2",
    timingEvidence: {
      providerId,
      paymentMode,
      cycle: "T+2",
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
      seedMarker: marker,
    },
    sourceRows: {
      orders: {
        order_id: orderId,
        gross_amount: gross,
        merchant_id: scenario.merchantId,
        synthetic: true,
        seedMarker: marker,
      },
      gateway: {
        gateway_reference: gatewayReference,
        order_id: orderId,
        payment_mode: paymentMode,
        captured_amount: gross,
        provider_id: providerId,
        captured_at: transactionAt.toISOString(),
        synthetic: true,
        seedMarker: marker,
      },
      settlements:
        actualSettledAmount === null
          ? null
          : {
              settlement_batch_id: settlementBatchId,
              order_id: orderId,
              gateway_reference: gatewayReference,
              gross_collected: gross,
              expected_net: expectedNet,
              settled_amount: actualSettledAmount,
              utr,
              bank_utr: bankUtr,
              bank_credit_amount: bankCreditAmount,
              settlement_status: settlementStatus,
              synthetic: true,
              seedMarker: marker,
            },
    },
    scenario,
    caseStatus,
    caseOrigin,
    casePriority,
    caseNotes,
  };
}

const lines = [
  buildLine({
    slug: "credited-with-utr",
    title: "Credited settlement with UTR and matching bank credit",
    providerId: "razorpay_demo",
    paymentMode: "UPI",
    reconciliationStatus: "matched",
    severity: "low",
    gross: 12500,
    mdr: 112.5,
    gst: 20.25,
    settledAmount: 12367.25,
    expectedDayOffset: -9,
    actualDayOffset: -7,
    utr: "UTR-DEMO-1001",
    settlementStatus: "credited",
  }),
  buildLine({
    slug: "pending-scheduled",
    title: "Pending settlement scheduled inside the synthetic cycle",
    providerId: "cashfree_demo",
    paymentMode: "UPI",
    reconciliationStatus: "pending",
    severity: "low",
    gross: 8300,
    mdr: 74.7,
    gst: 13.45,
    settledAmount: null,
    expectedDayOffset: 1,
    utr: null,
    settlementStatus: "scheduled",
  }),
  buildLine({
    slug: "held-settlement",
    title: "Held settlement pending analyst evidence review",
    providerId: "payu_demo",
    paymentMode: "Card",
    reconciliationStatus: "missing_settlement",
    severity: "high",
    gross: 21900,
    mdr: 438,
    gst: 78.84,
    hold: 21383.16,
    settledAmount: null,
    expectedDayOffset: -6,
    utr: null,
    settlementStatus: "held",
    caseStatus: "investigating",
    caseOrigin: "settlement_overdue",
    caseNotes:
      "Line-level merchant statement case: settlement is held in the synthetic statement and needs evidence review.",
  }),
  buildLine({
    slug: "failed-payout",
    title: "Failed payout with retry exhausted",
    providerId: "razorpay_demo",
    paymentMode: "Netbanking",
    reconciliationStatus: "missing_settlement",
    severity: "high",
    gross: 17650,
    mdr: 141.2,
    gst: 25.42,
    settledAmount: null,
    expectedDayOffset: -5,
    utr: null,
    settlementStatus: "failed",
    caseStatus: "open",
    caseOrigin: "settlement_overdue",
    caseNotes:
      "Line-level merchant statement case: failed synthetic payout has no UTR and no bank credit.",
  }),
  buildLine({
    slug: "partially-credited",
    title: "Partially credited bank amount below expected net",
    providerId: "cashfree_demo",
    paymentMode: "Card",
    reconciliationStatus: "amount_mismatch",
    severity: "medium",
    gross: 14400,
    mdr: 288,
    gst: 51.84,
    settledAmount: 12000,
    expectedDayOffset: -8,
    actualDayOffset: -6,
    utr: "UTR-DEMO-1005",
    settlementStatus: "partially_credited",
    caseStatus: "open",
    caseNotes:
      "Line-level merchant statement case: bank credit is lower than expected merchant payable.",
  }),
  buildLine({
    slug: "delayed-credit",
    title: "Delayed credit arrived after the expected settlement date",
    providerId: "payu_demo",
    paymentMode: "UPI",
    reconciliationStatus: "matched",
    severity: "medium",
    gross: 9850,
    mdr: 88.65,
    gst: 15.96,
    settledAmount: 9745.39,
    expectedDayOffset: -12,
    actualDayOffset: -8,
    utr: "UTR-DEMO-1006",
    settlementStatus: "credited_late",
    caseStatus: "resolved",
    caseNotes:
      "Line-level merchant statement case: synthetic credit arrived late and was closed after evidence review.",
  }),
  buildLine({
    slug: "missing-utr",
    title: "Settlement row has amount but missing UTR",
    providerId: "razorpay_demo",
    paymentMode: "Wallet",
    reconciliationStatus: "missing_settlement",
    severity: "medium",
    gross: 6700,
    mdr: 67,
    gst: 12.06,
    settledAmount: 6620.94,
    expectedDayOffset: -7,
    actualDayOffset: -5,
    utr: null,
    settlementStatus: "credited_missing_utr",
    caseStatus: "open",
    caseOrigin: "settlement_overdue",
    caseNotes:
      "Line-level merchant statement case: credited amount cannot be tied to a bank UTR.",
  }),
  buildLine({
    slug: "duplicate-utr",
    title: "Duplicate UTR used across two statement lines",
    providerId: "cashfree_demo",
    paymentMode: "Netbanking",
    reconciliationStatus: "duplicate",
    severity: "high",
    gross: 15800,
    mdr: 126.4,
    gst: 22.75,
    settledAmount: 15650.85,
    expectedDayOffset: -10,
    actualDayOffset: -8,
    utr: "UTR-DEMO-DUP-77",
    settlementStatus: "duplicate_utr",
    caseStatus: "investigating",
    caseNotes:
      "Line-level merchant statement case: duplicate UTR needs bank-credit mapping review.",
  }),
  buildLine({
    slug: "amount-mismatch",
    title: "Bank credit amount differs from expected net settlement",
    providerId: "payu_demo",
    paymentMode: "Wallet",
    reconciliationStatus: "amount_mismatch",
    severity: "medium",
    gross: 11200,
    mdr: 100.8,
    gst: 18.14,
    settledAmount: 10950,
    expectedDayOffset: -6,
    actualDayOffset: -4,
    utr: "UTR-DEMO-1009",
    settlementStatus: "amount_mismatch",
    caseStatus: "open",
    caseNotes:
      "Line-level merchant statement case: bank credit does not equal deterministic expected net.",
  }),
  buildLine({
    slug: "forward-refund",
    title: "Forward refund deducted from a later settlement batch",
    providerId: "razorpay_demo",
    paymentMode: "UPI",
    reconciliationStatus: "matched",
    severity: "low",
    gross: 13100,
    mdr: 117.9,
    gst: 21.22,
    refund: 1750,
    settledAmount: 11210.88,
    expectedDayOffset: -4,
    actualDayOffset: -2,
    utr: "UTR-DEMO-1010",
    settlementStatus: "credited_forward_refund",
  }),
  buildLine({
    slug: "forward-chargeback",
    title: "Forward chargeback deducted from a later payable",
    providerId: "cashfree_demo",
    paymentMode: "Card",
    reconciliationStatus: "matched",
    severity: "low",
    gross: 18900,
    mdr: 378,
    gst: 68.04,
    chargeback: 2400,
    settledAmount: 16053.96,
    expectedDayOffset: -3,
    actualDayOffset: -1,
    utr: "UTR-DEMO-1011",
    settlementStatus: "credited_forward_chargeback",
  }),
  buildLine({
    slug: "hold-release",
    title: "Prior hold released into the current statement",
    providerId: "payu_demo",
    paymentMode: "Netbanking",
    reconciliationStatus: "matched",
    severity: "low",
    gross: 10100,
    mdr: 80.8,
    gst: 14.54,
    release: 3200,
    settledAmount: 13204.66,
    expectedDayOffset: -2,
    actualDayOffset: 0,
    utr: "UTR-DEMO-1012",
    settlementStatus: "credited_hold_released",
    caseStatus: "resolved",
    caseNotes:
      "Line-level merchant statement case: prior synthetic hold release was verified against statement evidence.",
  }),
];

await client.connect();
await client.query("BEGIN");

try {
  const organization = await client.query(
    "SELECT id FROM organizations WHERE slug = 'payops-portfolio'",
  );
  const organizationId = organization.rows[0]?.id;
  if (!organizationId) throw new Error("Run npm run db:migrate before seeding.");

  const users = await client.query(
    `SELECT id, name, role FROM users
     WHERE organization_id = $1 AND role IN ('admin', 'analyst')
     ORDER BY role`,
    [organizationId],
  );
  const admin = users.rows.find((user) => user.role === "admin");
  const analyst = users.rows.find((user) => user.role === "analyst") ?? admin;
  if (!admin || !analyst) throw new Error("Run seed-users before this seed.");

  const hasMerchantSettlementTables = await tableExists(
    "merchant_settlement_batches",
  );
  const hasSettlementImportTables = await tableExists("settlement_import_batches");

  await client.query(
    `DELETE FROM audit_events
     WHERE organization_id = $1 AND details->>'seedMarker' = $2`,
    [organizationId, marker],
  );
  if (hasSettlementImportTables) {
    await client.query(
      `DELETE FROM settlement_evidence_packets packet
       USING settlement_import_batches batch
       WHERE packet.organization_id = $1
         AND packet.import_batch_id = batch.id
         AND batch.organization_id = packet.organization_id
         AND batch.seed_marker = $2`,
      [organizationId, settlementImportMarker],
    );
    await client.query(
      `DELETE FROM settlement_adjustment_events event
       USING settlement_adjustment_proposals proposal,
             settlement_import_exceptions exception,
             settlement_import_batches batch
       WHERE event.organization_id = $1
         AND event.adjustment_id = proposal.id
         AND proposal.organization_id = event.organization_id
         AND proposal.exception_id = exception.id
         AND exception.organization_id = proposal.organization_id
         AND exception.import_batch_id = batch.id
         AND batch.organization_id = exception.organization_id
         AND batch.seed_marker = $2`,
      [organizationId, settlementImportMarker],
    );
    await client.query(
      `DELETE FROM settlement_adjustment_proposals proposal
       USING settlement_import_exceptions exception,
             settlement_import_batches batch
       WHERE proposal.organization_id = $1
         AND proposal.exception_id = exception.id
         AND exception.organization_id = proposal.organization_id
         AND exception.import_batch_id = batch.id
         AND batch.organization_id = exception.organization_id
         AND batch.seed_marker = $2`,
      [organizationId, settlementImportMarker],
    );
    await client.query(
      `DELETE FROM settlement_import_exceptions exception
       USING settlement_import_batches batch
       WHERE exception.organization_id = $1
         AND exception.import_batch_id = batch.id
         AND batch.organization_id = exception.organization_id
         AND batch.seed_marker = $2`,
      [organizationId, settlementImportMarker],
    );
    await client.query(
      `DELETE FROM settlement_import_comparisons comparison
       USING settlement_import_batches batch
       WHERE comparison.organization_id = $1
         AND comparison.import_batch_id = batch.id
         AND batch.organization_id = comparison.organization_id
         AND batch.seed_marker = $2`,
      [organizationId, settlementImportMarker],
    );
    await client.query(
      `DELETE FROM settlement_import_rows row
       USING settlement_import_batches batch
       WHERE row.organization_id = $1
         AND row.import_batch_id = batch.id
         AND batch.organization_id = row.organization_id
         AND batch.seed_marker = $2`,
      [organizationId, settlementImportMarker],
    );
    await client.query(
      "DELETE FROM settlement_import_batches WHERE organization_id = $1 AND seed_marker = $2",
      [organizationId, settlementImportMarker],
    );
  }
  if (hasMerchantSettlementTables) {
    await client.query(
      `DELETE FROM merchant_settlement_events
       WHERE organization_id = $1 AND details->>'seedMarker' = $2`,
      [organizationId, marker],
    );
    await client.query(
      `DELETE FROM merchant_settlement_case_links link
       USING merchant_settlement_batches batch
       WHERE link.organization_id = $1
         AND link.batch_id = batch.id
         AND batch.classification_evidence->>'seedMarker' = $2`,
      [organizationId, marker],
    );
    await client.query(
      `DELETE FROM merchant_settlement_bank_credits credit
       USING merchant_settlement_batches batch
       WHERE credit.organization_id = $1
         AND credit.batch_id = batch.id
         AND batch.classification_evidence->>'seedMarker' = $2`,
      [organizationId, marker],
    );
    await client.query(
      `DELETE FROM merchant_settlement_deductions deduction
       USING merchant_settlement_batches batch
       WHERE deduction.organization_id = $1
         AND deduction.batch_id = batch.id
         AND batch.classification_evidence->>'seedMarker' = $2`,
      [organizationId, marker],
    );
    await client.query(
      `DELETE FROM merchant_settlement_lines line
       USING merchant_settlement_batches batch
       WHERE line.organization_id = $1
         AND line.batch_id = batch.id
         AND batch.classification_evidence->>'seedMarker' = $2`,
      [organizationId, marker],
    );
    await client.query(
      `DELETE FROM merchant_settlement_batches
       WHERE organization_id = $1 AND classification_evidence->>'seedMarker' = $2`,
      [organizationId, marker],
    );
    await client.query(
      `DELETE FROM merchant_accounts
       WHERE organization_id = $1 AND merchant_reference = 'merchant-demo-urbanthreads'`,
      [organizationId],
    );
  }
  await client.query(
    `DELETE FROM reconciliation_runs
     WHERE organization_id = $1 AND source_files->>'seed' = $2`,
    [organizationId, marker],
  );

  let merchantAccountId = null;
  if (hasMerchantSettlementTables) {
    const merchantAccount = await client.query(
      `INSERT INTO merchant_accounts (
         organization_id, merchant_reference, display_name, status
       ) VALUES (
         $1,'merchant-demo-urbanthreads','Urban Threads Demo','active'
       ) RETURNING id`,
      [organizationId],
    );
    merchantAccountId = merchantAccount.rows[0].id;
  }

  const insertedCaseIds = [];
  const insertedBatchIds = [];
  for (const providerId of providers) {
    const providerLines = lines.filter((line) => line.providerId === providerId);
    const processedValue = providerLines.reduce((total, line) => total + line.gross, 0);
    const matchedValue = providerLines
      .filter((line) => line.reconciliationStatus === "matched")
      .reduce((total, line) => total + line.gross, 0);
    const exceptionCount = providerLines.filter(
      (line) => !["matched", "pending"].includes(line.reconciliationStatus),
    ).length;
    const run = await client.query(
      `INSERT INTO reconciliation_runs (
         organization_id, name, source_type, provider_id, status,
         total_orders, processed_value, matched_value, unmatched_value,
         matched_count, exception_count, match_rate, source_files, created_at
       ) VALUES (
         $1,$2,'demo',$3,'completed',$4,$5,$6,$7,$8,$9,$10,$11,NOW()
       ) RETURNING id`,
      [
        organizationId,
        `Merchant settlement statements seed - ${providerId}`,
        providerId,
        providerLines.length,
        processedValue,
        matchedValue,
        money(processedValue - matchedValue),
        providerLines.filter((line) => line.reconciliationStatus === "matched").length,
        exceptionCount,
        money((providerLines.filter((line) => line.reconciliationStatus === "matched").length / providerLines.length) * 100),
        JSON.stringify({
          seed: marker,
          fictional: true,
          module: "merchant_settlement_statements",
          noMoneyMovement: true,
          scenarios: providerLines.map((line) => line.slug),
        }),
      ],
    );

    for (let index = 0; index < providerLines.length; index += 1) {
      const line = providerLines[index];
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
           $15,'gateway_capture',$16,$17,$18,$19,$20,$21,NOW()
         ) RETURNING id`,
        [
          organizationId,
          run.rows[0].id,
          line.orderId,
          line.gatewayReference,
          line.paymentMode,
          line.gross,
          line.gross,
          line.actualSettledAmount,
          line.expectedNet,
          line.variance,
          line.reconciliationStatus,
          line.severity,
          line.summary,
          JSON.stringify(line.evidence),
          line.transactionAt,
          line.settlementRecordedAt,
          line.settlementCycle,
          line.expectedSettlementAt,
          policyVersion,
          calendarVersion,
          JSON.stringify(line.timingEvidence),
        ],
      );
      const itemId = insertedItem.rows[0].id;
      const sourceEntries = [
        ["orders", line.sourceRows.orders],
        ["gateway", line.sourceRows.gateway],
        ["settlements", line.sourceRows.settlements],
      ].filter(([, row]) => row !== null);

      for (let sourceIndex = 0; sourceIndex < sourceEntries.length; sourceIndex += 1) {
        const [sourceType, row] = sourceEntries[sourceIndex];
        const normalized = {
          ...row,
          merchantStatementScenario: line.scenario,
        };
        await client.query(
          `INSERT INTO reconciliation_source_evidence (
             organization_id, run_id, item_id, source_type, row_number,
             normalized_values, source_values, integrity_hash, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,NOW())`,
          [
            organizationId,
            run.rows[0].id,
            itemId,
            sourceType,
            index * 10 + sourceIndex + 1,
            JSON.stringify(normalized),
            hashEvidence(normalized),
          ],
        );
      }

      if (line.caseStatus) {
        const dueAt = daysFromNow(
          line.casePriority === "high" ? 0 : line.casePriority === "medium" ? 1 : 3,
        );
        const resolvedAt = line.caseStatus === "resolved" ? daysFromNow(-1) : null;
        const paymentCase = await client.query(
          `INSERT INTO operations_cases (
             organization_id, item_id, run_id, case_status, priority, owner,
             notes, due_at, resolved_at, resolution_reason,
             resolution_evidence_confirmed, resolved_by_user_id,
             resolved_by_name, case_origin, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()
           ) RETURNING id`,
          [
            organizationId,
            itemId,
            run.rows[0].id,
            line.caseStatus,
            line.casePriority,
            line.caseStatus === "open" ? null : analyst.name,
            line.caseNotes,
            dueAt,
            resolvedAt,
            line.caseStatus === "resolved"
              ? "Synthetic merchant statement evidence reviewed and linked to the line item."
              : null,
            line.caseStatus === "resolved",
            line.caseStatus === "resolved" ? admin.id : null,
            line.caseStatus === "resolved" ? admin.name : null,
            line.caseOrigin,
          ],
        );
        insertedCaseIds.push(paymentCase.rows[0].id);
        line.caseId = paymentCase.rows[0].id;
        await client.query(
          `INSERT INTO operations_case_comments (
             organization_id, case_id, author_user_id, author_name, body
           ) VALUES ($1,$2,$3,$4,$5)`,
          [
            organizationId,
            paymentCase.rows[0].id,
            analyst.id,
            analyst.name,
            `Linked to merchant settlement statement scenario "${line.slug}" with seed marker ${marker}.`,
          ],
        );
      }

      if (hasMerchantSettlementTables) {
        const deductions = settlementDeductionsFor(line);
        const tableGross = Math.max(line.gross, line.expectedNet);
        const deductionAmount = money(Math.max(tableGross - line.expectedNet, 0));
        const bankCreditAmount =
          line.actualSettledAmount === null || !line.scenario.utr
            ? 0
            : line.actualSettledAmount;
        const varianceAmount = money(bankCreditAmount - line.expectedNet);
        const statementReference = `MSS-${line.slug}`;
        const batch = await client.query(
          `INSERT INTO merchant_settlement_batches (
             organization_id, merchant_account_id, source_run_id,
             statement_reference, provider_id, payment_mode, settlement_cycle,
             status, utr, expected_settlement_at, actual_settlement_at,
             gross_amount, deduction_amount, net_amount, bank_credit_amount,
             variance_amount, utr_match_status, classification_evidence
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
           ) RETURNING id`,
          [
            organizationId,
            merchantAccountId,
            run.rows[0].id,
            statementReference,
            line.providerId,
            line.paymentMode,
            line.settlementCycle,
            batchStatusFor(line),
            line.scenario.utr,
            line.expectedSettlementAt,
            line.settlementRecordedAt,
            tableGross,
            deductionAmount,
            line.expectedNet,
            bankCreditAmount,
            varianceAmount,
            utrStatusFor(line),
            JSON.stringify({
              ...line.scenario,
              seedMarker: marker,
              sourceItemId: itemId,
              generatedFrom: "scripts/seed-merchant-settlements.mjs",
            }),
          ],
        );
        const batchId = batch.rows[0].id;
        insertedBatchIds.push(batchId);

        const settlementLine = await client.query(
          `INSERT INTO merchant_settlement_lines (
             organization_id, batch_id, source_item_id, source_run_id, order_id,
             gateway_reference, transaction_at, payment_mode, gross_amount,
             deduction_amount, net_amount, line_status, evidence
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            organizationId,
            batchId,
            itemId,
            run.rows[0].id,
            line.orderId,
            line.gatewayReference,
            line.transactionAt,
            line.paymentMode,
            line.gross,
            deductionAmount,
            line.expectedNet,
            lineStatusFor(line),
            JSON.stringify({
              seedMarker: marker,
              scenario: line.slug,
              noMoneyMovement: true,
              sourceEvidence: line.sourceRows,
            }),
          ],
        );

        for (const deduction of deductions) {
          await client.query(
            `INSERT INTO merchant_settlement_deductions (
               organization_id, batch_id, line_id, deduction_type, direction,
               amount, tax_amount, description, forward_applied, evidence
             ) VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9)`,
            [
              organizationId,
              batchId,
              settlementLine.rows[0].id,
              deduction.deductionType,
              deduction.direction,
              deduction.amount,
              deduction.description,
              deduction.forwardApplied,
              JSON.stringify({
                seedMarker: marker,
                scenario: line.slug,
                syntheticOnly: true,
              }),
            ],
          );
        }

        if (line.actualSettledAmount !== null && line.scenario.utr) {
          const creditRows =
            line.slug === "duplicate-utr"
              ? [
                  {
                    amount: line.actualSettledAmount,
                    matchStatus: "duplicate",
                    suffix: "A",
                  },
                  {
                    amount: 2500,
                    matchStatus: "duplicate",
                    suffix: "B",
                  },
                ]
              : [
                  {
                    amount: line.actualSettledAmount,
                    matchStatus:
                      utrStatusFor(line) === "amount_mismatch"
                        ? "amount_mismatch"
                        : "matched",
                    suffix: "A",
                  },
                ];
          for (const credit of creditRows) {
            await client.query(
              `INSERT INTO merchant_settlement_bank_credits (
                 organization_id, batch_id, utr, amount, credited_at,
                 bank_reference, match_status, evidence
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                organizationId,
                batchId,
                line.scenario.utr,
                credit.amount,
                line.settlementRecordedAt ?? daysFromNow(0),
                `BANK-DEMO-${line.slug}-${credit.suffix}`,
                credit.matchStatus,
                JSON.stringify({
                  seedMarker: marker,
                  scenario: line.slug,
                  syntheticOnly: true,
                }),
              ],
            );
          }
        }

        if (line.caseId) {
          await client.query(
            `INSERT INTO merchant_settlement_case_links (
               organization_id, batch_id, line_id, case_id, link_type
             ) VALUES ($1,$2,$3,$4,$5)`,
            [
              organizationId,
              batchId,
              settlementLine.rows[0].id,
              line.caseId,
              caseLinkTypeFor(line),
            ],
          );
          await client.query(
            `INSERT INTO merchant_settlement_events (
               organization_id, batch_id, actor_user_id, actor_name,
               event_type, details
             ) VALUES ($1,$2,$3,$4,'case_linked',$5)`,
            [
              organizationId,
              batchId,
              analyst.id,
              analyst.name,
              JSON.stringify({
                seedMarker: marker,
                caseId: line.caseId,
                scenario: line.slug,
              }),
            ],
          );
        }

        await client.query(
          `INSERT INTO merchant_settlement_events (
             organization_id, batch_id, actor_user_id, actor_name,
             event_type, details
           ) VALUES ($1,$2,$3,$4,'batch_refreshed',$5)`,
          [
            organizationId,
            batchId,
            admin.id,
            admin.name,
            JSON.stringify({
              seedMarker: marker,
              scenario: line.slug,
              syntheticOnly: true,
            }),
          ],
        );
      }
    }
  }

  await client.query(
     `INSERT INTO audit_events (
       organization_id, actor_user_id, actor_name, action,
       entity_type, entity_id, details
     ) VALUES ($1::uuid,$2,$3,'merchant_settlements.seeded','organization',$1::text,$4)`,
    [
      organizationId,
      admin.id,
      admin.name,
      JSON.stringify({
        seedMarker: marker,
        scenarioCount: lines.length,
        merchantSettlementBatchCount: insertedBatchIds.length,
        lineLevelCaseCount: insertedCaseIds.length,
        caseIds: insertedCaseIds,
        noMoneyMovement: true,
        syntheticOnly: true,
      }),
    ],
  );

  await client.query("COMMIT");
  console.log(
    `Seeded ${lines.length} merchant settlement statement line(s), ${insertedBatchIds.length} batch(es), and ${insertedCaseIds.length} linked case(s) with marker ${marker}.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}

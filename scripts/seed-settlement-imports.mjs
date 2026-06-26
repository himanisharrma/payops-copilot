import { createHash } from "node:crypto";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";
const client = new pg.Client({ connectionString: databaseUrl });

const marker = "settlement-import-desk-v1";
const merchantMarker = "merchant-settlements-v1";

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function money(value) {
  return Number(Number(value).toFixed(2));
}

function daysFromNow(days, hours = 0) {
  const date = new Date(Date.now() + (days * 24 + hours) * 3_600_000);
  date.setUTCMinutes(30, 0, 0);
  return date;
}

async function tableExists(tableName) {
  const result = await client.query("SELECT to_regclass($1) AS table_name", [
    tableName,
  ]);
  return Boolean(result.rows[0]?.table_name);
}

function sourceHashFor(rows) {
  return hash(
    rows
      .map((row) =>
        [
          row.statementReference,
          row.orderId,
          row.gatewayReference,
          row.netAmount,
          row.utr ?? "",
          row.exceptionType ?? "matched",
        ].join("|"),
      )
      .join("\n"),
  );
}

function rowFingerprint(row) {
  return hash(
    stableJson({
      statementReference: row.statementReference,
      merchantReference: row.merchantReference,
      orderId: row.orderId,
      gatewayReference: row.gatewayReference,
      paymentMode: row.paymentMode,
      grossAmount: row.grossAmount,
      deductionAmount: row.deductionAmount,
      netAmount: row.netAmount,
      deductionType: row.deductionType,
      utr: row.utr,
      bankReference: row.bankReference,
      settlementStatus: row.settlementStatus,
      expectedSettlementAt: row.expectedSettlementAt,
      actualSettlementAt: row.actualSettlementAt,
    }),
  );
}

function priorityFor(exceptionType) {
  if (["amount_mismatch", "duplicate_utr", "failed_payout"].includes(exceptionType)) {
    return "high";
  }
  if (exceptionType) return "medium";
  return "low";
}

function summaryFor(row) {
  return `${row.exceptionType.replaceAll("_", " ")} on imported statement ${
    row.statementReference
  } for order ${row.orderId}.`;
}

async function deleteSeedData(organizationId) {
  await client.query(
    `DELETE FROM settlement_evidence_packets packet
     USING settlement_import_batches batch
     WHERE packet.organization_id = $1
       AND packet.import_batch_id = batch.id
       AND batch.organization_id = packet.organization_id
       AND batch.seed_marker = $2`,
    [organizationId, marker],
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
    [organizationId, marker],
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
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM settlement_import_exceptions exception
     USING settlement_import_batches batch
     WHERE exception.organization_id = $1
       AND exception.import_batch_id = batch.id
       AND batch.organization_id = exception.organization_id
       AND batch.seed_marker = $2`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM settlement_import_comparisons comparison
     USING settlement_import_batches batch
     WHERE comparison.organization_id = $1
       AND comparison.import_batch_id = batch.id
       AND batch.organization_id = comparison.organization_id
       AND batch.seed_marker = $2`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM settlement_import_rows row
     USING settlement_import_batches batch
     WHERE row.organization_id = $1
       AND row.import_batch_id = batch.id
       AND batch.organization_id = row.organization_id
       AND batch.seed_marker = $2`,
    [organizationId, marker],
  );
  await client.query(
    "DELETE FROM settlement_import_batches WHERE organization_id = $1 AND seed_marker = $2",
    [organizationId, marker],
  );
}

async function loadLedgerRows(organizationId) {
  const result = await client.query(
    `SELECT batch.id AS batch_id,
       batch.statement_reference,
       batch.provider_id,
       batch.payment_mode,
       batch.status AS batch_status,
       batch.utr AS batch_utr,
       batch.expected_settlement_at,
       batch.actual_settlement_at,
       batch.net_amount::text AS batch_net_amount,
       batch.deduction_amount::text AS batch_deduction_amount,
       line.id AS line_id,
       line.order_id,
       line.gateway_reference,
       line.gross_amount::text AS line_gross_amount,
       line.deduction_amount::text AS line_deduction_amount,
       line.net_amount::text AS line_net_amount,
       credit.id AS bank_credit_id,
       credit.amount::text AS bank_credit_amount,
       credit.bank_reference,
       case_link.case_id AS operations_case_id,
       deduction.deduction_type
     FROM merchant_settlement_batches batch
     JOIN merchant_settlement_lines line
       ON line.organization_id = batch.organization_id
      AND line.batch_id = batch.id
     LEFT JOIN LATERAL (
       SELECT credit.*
       FROM merchant_settlement_bank_credits credit
       WHERE credit.organization_id = batch.organization_id
         AND credit.batch_id = batch.id
       ORDER BY credit.created_at
       LIMIT 1
     ) credit ON true
     LEFT JOIN LATERAL (
       SELECT case_link.case_id
       FROM merchant_settlement_case_links case_link
       WHERE case_link.organization_id = batch.organization_id
         AND case_link.batch_id = batch.id
         AND case_link.line_id = line.id
       ORDER BY case_link.linked_at DESC
       LIMIT 1
     ) case_link ON true
     LEFT JOIN LATERAL (
       SELECT deduction.deduction_type
       FROM merchant_settlement_deductions deduction
       WHERE deduction.organization_id = batch.organization_id
         AND deduction.batch_id = batch.id
         AND deduction.line_id = line.id
       ORDER BY
         CASE WHEN deduction.deduction_type IN ('refund','chargeback','hold') THEN 0 ELSE 1 END,
         deduction.created_at
       LIMIT 1
     ) deduction ON true
     WHERE batch.organization_id = $1
       AND batch.classification_evidence->>'seedMarker' = $2`,
    [organizationId, merchantMarker],
  );
  return new Map(
    result.rows.map((row) => [
      row.statement_reference.replace(/^MSS-/, ""),
      {
        ...row,
        batchNetAmount: Number(row.batch_net_amount),
        batchDeductionAmount: Number(row.batch_deduction_amount),
        lineGrossAmount: Number(row.line_gross_amount),
        lineDeductionAmount: Number(row.line_deduction_amount),
        lineNetAmount: Number(row.line_net_amount),
        bankCreditAmount:
          row.bank_credit_amount === null ? null : Number(row.bank_credit_amount),
      },
    ]),
  );
}

function statementRow(ledger, overrides = {}) {
  const grossAmount = money(overrides.grossAmount ?? ledger.lineGrossAmount);
  const deductionAmount = money(
    overrides.deductionAmount ?? ledger.batchDeductionAmount,
  );
  const netAmount = money(grossAmount - deductionAmount);
  return {
    ledger,
    statementReference: overrides.statementReference ?? ledger.statement_reference,
    merchantReference: "merchant-demo-urbanthreads",
    orderId: overrides.orderId ?? ledger.order_id,
    gatewayReference: overrides.gatewayReference ?? ledger.gateway_reference,
    paymentMode: overrides.paymentMode ?? ledger.payment_mode,
    grossAmount,
    deductionAmount,
    netAmount,
    deductionType: overrides.deductionType ?? ledger.deduction_type ?? "mdr",
    utr: overrides.utr === undefined ? ledger.batch_utr : overrides.utr,
    bankReference: overrides.bankReference ?? ledger.bank_reference,
    settlementStatus: overrides.settlementStatus ?? ledger.batch_status,
    expectedSettlementAt:
      overrides.expectedSettlementAt ??
      new Date(ledger.expected_settlement_at).toISOString(),
    actualSettlementAt:
      overrides.actualSettlementAt ??
      (ledger.actual_settlement_at
        ? new Date(ledger.actual_settlement_at).toISOString()
        : null),
    exceptionType: overrides.exceptionType ?? null,
    amountVariance: 0,
    deductionVariance: 0,
  };
}

async function createImportBatch({
  organizationId,
  providerId,
  filename,
  importedBy,
  rows,
}) {
  const sourceHash = sourceHashFor(rows);
  const importReference = `IMP-${providerId}-${sourceHash.slice(0, 10)}`;
  const batch = await client.query(
    `INSERT INTO settlement_import_batches (
       organization_id, provider_id, import_reference, source_filename,
       source_hash, status, row_count, exception_count, evidence,
       seed_marker, imported_by_user_id, imported_by_name
     ) VALUES ($1,$2,$3,$4,$5,'staged',$6,0,$7,$8,$9,$10)
     RETURNING id`,
    [
      organizationId,
      providerId,
      importReference,
      filename,
      sourceHash,
      rows.length,
      JSON.stringify({
        seedMarker: marker,
        fictional: true,
        source: "scripts/seed-settlement-imports.mjs",
        noProviderConnection: true,
      }),
      marker,
      importedBy.id,
      importedBy.name,
    ],
  );
  const importBatchId = batch.rows[0].id;
  let exceptionCount = 0;
  let rowNumber = 0;
  for (const inputRow of rows) {
    rowNumber += 1;
    const fingerprint = rowFingerprint(inputRow);
    const row = await client.query(
      `INSERT INTO settlement_import_rows (
         organization_id, import_batch_id, row_number, row_fingerprint,
         statement_reference, merchant_reference, order_id, gateway_reference,
         payment_mode, gross_amount, deduction_amount, net_amount,
         deduction_type, utr, bank_reference, settlement_status,
         expected_settlement_at, actual_settlement_at,
         raw_values, normalized_values
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        organizationId,
        importBatchId,
        rowNumber,
        fingerprint,
        inputRow.statementReference,
        inputRow.merchantReference,
        inputRow.orderId,
        inputRow.gatewayReference,
        inputRow.paymentMode,
        inputRow.grossAmount,
        inputRow.deductionAmount,
        inputRow.netAmount,
        inputRow.deductionType,
        inputRow.utr,
        inputRow.bankReference,
        inputRow.settlementStatus,
        inputRow.expectedSettlementAt,
        inputRow.actualSettlementAt,
        JSON.stringify({
          seedMarker: marker,
          fictional: true,
          statement_reference: inputRow.statementReference,
          order_id: inputRow.orderId,
          gateway_reference: inputRow.gatewayReference,
        }),
        JSON.stringify({ ...inputRow, ledger: undefined }),
      ],
    );
    const amountVariance = money(
      inputRow.netAmount - Number(inputRow.ledger.batch_net_amount),
    );
    const deductionVariance = money(
      inputRow.deductionAmount - Number(inputRow.ledger.batch_deduction_amount),
    );
    const comparisonStatus = inputRow.exceptionType ? "exception" : "matched";
    const comparison = await client.query(
      `INSERT INTO settlement_import_comparisons (
         organization_id, import_batch_id, import_row_id,
         settlement_batch_id, settlement_line_id, bank_credit_id,
         operations_case_id, comparison_status, exception_type,
         amount_variance, deduction_variance, evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        organizationId,
        importBatchId,
        row.rows[0].id,
        inputRow.ledger.batch_id,
        inputRow.ledger.line_id,
        inputRow.exceptionType === "utr_not_found" ? null : inputRow.ledger.bank_credit_id,
        inputRow.ledger.operations_case_id,
        comparisonStatus,
        inputRow.exceptionType,
        amountVariance,
        deductionVariance,
        JSON.stringify({
          seedMarker: marker,
          fictional: true,
          reason: inputRow.exceptionType ?? "matched",
          amountVariance,
          deductionVariance,
        }),
      ],
    );
    if (inputRow.exceptionType) {
      exceptionCount += 1;
      await client.query(
        `INSERT INTO settlement_import_exceptions (
           organization_id, import_batch_id, comparison_id, import_row_id,
           settlement_batch_id, operations_case_id, exception_type,
           priority, status, exposure_amount, summary, evidence
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11)`,
        [
          organizationId,
          importBatchId,
          comparison.rows[0].id,
          row.rows[0].id,
          inputRow.ledger.batch_id,
          inputRow.ledger.operations_case_id,
          inputRow.exceptionType,
          priorityFor(inputRow.exceptionType),
          money(
            Math.max(
              Math.abs(amountVariance),
              Math.abs(deductionVariance),
              inputRow.netAmount,
            ),
          ),
          summaryFor(inputRow),
          JSON.stringify({
            seedMarker: marker,
            fictional: true,
            noMoneyMovement: true,
            statementReference: inputRow.statementReference,
            linkedOperationsCase: Boolean(inputRow.ledger.operations_case_id),
          }),
        ],
      );
    }
  }
  await client.query(
    `UPDATE settlement_import_batches
     SET status = $3, exception_count = $4, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [
      organizationId,
      importBatchId,
      exceptionCount > 0 ? "needs_review" : "compared",
      exceptionCount,
    ],
  );
  return importBatchId;
}

async function seedAdjustments(organizationId, analyst, admin) {
  const exceptions = await client.query(
    `SELECT exception.id, exception.exception_type, exception.exposure_amount::text
     FROM settlement_import_exceptions exception
     JOIN settlement_import_batches batch
       ON batch.id = exception.import_batch_id
      AND batch.organization_id = exception.organization_id
     WHERE exception.organization_id = $1
       AND batch.seed_marker = $2
       AND exception.exception_type IN ('amount_mismatch','forward_deduction_mismatch','duplicate_utr')
     ORDER BY exception.exception_type`,
    [organizationId, marker],
  );
  for (const exception of exceptions.rows) {
    const status =
      exception.exception_type === "forward_deduction_mismatch"
        ? "approved"
        : exception.exception_type === "duplicate_utr"
          ? "rejected"
          : "proposed";
    const proposal = await client.query(
      `INSERT INTO settlement_adjustment_proposals (
         organization_id, exception_id, adjustment_type, amount, reason,
         evidence_reference, status, proposed_by_user_id, proposed_by_name,
         decided_by_user_id, decided_by_name, decision_reason, decided_at
       ) VALUES ($1,$2,'manual_review',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        organizationId,
        exception.id,
        money(Number(exception.exposure_amount)),
        `Synthetic reviewer adjustment proposal for ${exception.exception_type}.`,
        `settlement-import-exception:${exception.id}`,
        status,
        analyst.id,
        analyst.name,
        status === "proposed" ? null : admin.id,
        status === "proposed" ? null : admin.name,
        status === "proposed"
          ? null
          : `Synthetic maker/checker decision for ${exception.exception_type}.`,
        status === "proposed" ? null : new Date(),
      ],
    );
    await client.query(
      `INSERT INTO settlement_adjustment_events (
         organization_id, adjustment_id, actor_user_id, actor_name, event_type, details
       ) VALUES ($1,$2,$3,$4,'proposed',$5)`,
      [
        organizationId,
        proposal.rows[0].id,
        analyst.id,
        analyst.name,
        JSON.stringify({ seedMarker: marker, exceptionType: exception.exception_type }),
      ],
    );
    if (status !== "proposed") {
      await client.query(
        `INSERT INTO settlement_adjustment_events (
           organization_id, adjustment_id, actor_user_id, actor_name, event_type, details
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          organizationId,
          proposal.rows[0].id,
          admin.id,
          admin.name,
          status,
          JSON.stringify({ seedMarker: marker, makerChecker: true }),
        ],
      );
      await client.query(
        `UPDATE settlement_import_exceptions
         SET status = $3, updated_at = NOW()
         WHERE organization_id = $1 AND id = $2`,
        [organizationId, exception.id, status === "approved" ? "resolved" : "open"],
      );
    } else {
      await client.query(
        `UPDATE settlement_import_exceptions
         SET status = 'adjustment_proposed', updated_at = NOW()
         WHERE organization_id = $1 AND id = $2`,
        [organizationId, exception.id],
      );
    }
  }
}

await client.connect();

try {
  const hasTables = await tableExists("settlement_import_batches");
  if (!hasTables) {
    console.log("Settlement import tables are not present; skipping seed.");
    process.exit(0);
  }

  const organization = await client.query(
    "SELECT id FROM organizations WHERE slug = 'payops-portfolio'",
  );
  if (!organization.rowCount) throw new Error("payops-portfolio organization missing.");
  const organizationId = organization.rows[0].id;
  const users = await client.query(
    `SELECT id, name, role
     FROM users
     WHERE organization_id = $1 AND role IN ('admin','analyst')
     ORDER BY role`,
    [organizationId],
  );
  const admin = users.rows.find((user) => user.role === "admin");
  const analyst = users.rows.find((user) => user.role === "analyst") ?? admin;
  if (!admin || !analyst) throw new Error("Demo admin and analyst users are required.");

  await deleteSeedData(organizationId);
  const ledger = await loadLedgerRows(organizationId);
  if (!ledger.size) {
    console.log("Merchant settlement seed data is not present; skipping import seed.");
    process.exit(0);
  }

  const get = (slug) => {
    const row = ledger.get(slug);
    if (!row) throw new Error(`Missing merchant settlement seed row: ${slug}`);
    return row;
  };

  const cleanRows = [
    statementRow(get("credited-with-utr"), { exceptionType: null }),
    statementRow(get("hold-release"), { exceptionType: null }),
  ];

  const exceptionRows = [
    statementRow(get("missing-utr"), {
      utr: null,
      bankReference: null,
      exceptionType: "missing_utr",
    }),
    statementRow(get("pending-scheduled"), {
      utr: "UTR-IMPORT-NOT-FOUND",
      settlementStatus: "credited",
      actualSettlementAt: daysFromNow(-1).toISOString(),
      exceptionType: "utr_not_found",
    }),
    statementRow(get("duplicate-utr"), {
      utr: "UTR-IMPORT-DUP-77",
      exceptionType: "duplicate_utr",
    }),
    statementRow(get("credited-with-utr"), {
      statementReference: "MSS-duplicate-upload-shadow",
      orderId: "MSS-DUPLICATE-UPLOAD-SHADOW",
      gatewayReference: "PG-MSS-DUPLICATE-UPLOAD-SHADOW",
      utr: "UTR-IMPORT-DUP-77",
      exceptionType: "duplicate_utr",
    }),
    statementRow(get("amount-mismatch"), {
      grossAmount: get("amount-mismatch").lineGrossAmount + 35,
      exceptionType: "amount_mismatch",
    }),
    statementRow(get("failed-payout"), {
      settlementStatus: "failed",
      utr: "UTR-IMPORT-FAILED-01",
      exceptionType: "failed_payout",
    }),
    statementRow(get("held-settlement"), {
      settlementStatus: "held",
      deductionType: "hold",
      exceptionType: "held_settlement",
    }),
    statementRow(get("delayed-credit"), {
      expectedSettlementAt: daysFromNow(-4).toISOString(),
      actualSettlementAt: daysFromNow(0).toISOString(),
      exceptionType: "delayed_credit",
    }),
    statementRow(get("pending-scheduled"), {
      statementReference: "MSS-retry-exhausted-import",
      orderId: "MSS-RETRY-EXHAUSTED-IMPORT",
      gatewayReference: "PG-MSS-RETRY-EXHAUSTED-IMPORT",
      utr: "UTR-IMPORT-RETRY-01",
      settlementStatus: "sent",
      expectedSettlementAt: daysFromNow(-3).toISOString(),
      exceptionType: "retry_exhausted",
    }),
    statementRow(get("credited-with-utr"), {
      statementReference: "MSS-deduction-mismatch-import",
      orderId: "MSS-DEDUCTION-MISMATCH-IMPORT",
      gatewayReference: "PG-MSS-DEDUCTION-MISMATCH-IMPORT",
      deductionAmount: get("credited-with-utr").batchDeductionAmount + 12,
      exceptionType: "deduction_mismatch",
    }),
    statementRow(get("held-settlement"), {
      statementReference: "MSS-unexplained-hold-import",
      orderId: "MSS-UNEXPLAINED-HOLD-IMPORT",
      gatewayReference: "PG-MSS-UNEXPLAINED-HOLD-IMPORT",
      deductionType: "hold",
      grossAmount: get("held-settlement").lineGrossAmount + 1000,
      deductionAmount: get("held-settlement").batchDeductionAmount + 500,
      settlementStatus: "credited",
      exceptionType: "unexplained_hold",
    }),
    statementRow(get("forward-refund"), {
      deductionType: "refund",
      deductionAmount: get("forward-refund").batchDeductionAmount + 25,
      exceptionType: "forward_deduction_mismatch",
    }),
    statementRow(get("forward-chargeback"), {
      deductionType: "chargeback",
      deductionAmount: get("forward-chargeback").batchDeductionAmount + 50,
      exceptionType: "forward_deduction_mismatch",
    }),
  ];

  await createImportBatch({
    organizationId,
    providerId: "razorpay_demo",
    filename: "synthetic-clean-settlement-statement.csv",
    importedBy: analyst,
    rows: cleanRows,
  });
  await createImportBatch({
    organizationId,
    providerId: "cashfree_demo",
    filename: "synthetic-exception-settlement-statement.csv",
    importedBy: analyst,
    rows: exceptionRows,
  });
  await seedAdjustments(organizationId, analyst, admin);

  await client.query(
    `INSERT INTO audit_events (
       organization_id, actor_user_id, actor_name, action, entity_type, entity_id, details
     ) VALUES ($1::uuid,$2,$3,'settlement_imports.seeded','organization',$1::text,$4)`,
    [
      organizationId,
      admin.id,
      admin.name,
      JSON.stringify({
        seedMarker: marker,
        syntheticOnly: true,
        noProviderConnection: true,
        noMoneyMovement: true,
      }),
    ],
  );

  console.log("Seeded synthetic settlement imports and adjustment desk scenarios.");
} finally {
  await client.end();
}

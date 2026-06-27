import { createHash } from "node:crypto";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";
const client = new pg.Client({ connectionString: databaseUrl });
const marker = "source-ingestion-control-plane-v1";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isoFor(dayOffset, hour, minute = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function businessDate(dayOffset) {
  return isoFor(dayOffset, 0).slice(0, 10);
}

async function deleteSeedData(organizationId) {
  await client.query(
    `DELETE FROM source_ingestion_readiness_snapshots
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM source_ingestion_events
     WHERE organization_id = $1 AND details->>'seedMarker' = $2`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM source_ingestion_arrivals
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM source_ingestion_expectations
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, marker],
  );
  await client.query(
    `DELETE FROM source_ingestion_sources
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, marker],
  );
}

async function upsertSource(organizationId, source) {
  const result = await client.query(
    `INSERT INTO source_ingestion_sources (
       organization_id, source_key, display_name, provider_id, source_kind,
       transport_type, expected_frequency, owner_team, evidence, seed_marker
     ) VALUES ($1,$2,$3,$4,$5,$6,'daily',$7,$8,$9)
     ON CONFLICT (organization_id, source_key)
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [
      organizationId,
      source.key,
      source.name,
      source.provider,
      source.kind,
      source.transport,
      source.owner,
      JSON.stringify({ synthetic: true, seedMarker: marker, fictional: true }),
      marker,
    ],
  );
  return result.rows[0].id;
}

async function expectation(organizationId, sourceId, date, hour, required = true) {
  const result = await client.query(
    `INSERT INTO source_ingestion_expectations (
       organization_id, source_id, business_date, expected_arrival_at,
       grace_minutes, required_for_close, expected_filename_pattern, status,
       seed_marker
     ) VALUES ($1,$2,$3,$4,60,$5,'*.csv','expected',$6)
     RETURNING id`,
    [organizationId, sourceId, date, `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`, required, marker],
  );
  return result.rows[0].id;
}

async function arrival(organizationId, expectationId, sourceId, options) {
  const content = options.content;
  const fileHash = hash(content);
  const version = await client.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM source_ingestion_arrivals
     WHERE organization_id = $1 AND expectation_id = $2`,
    [organizationId, expectationId],
  );
  const result = await client.query(
    `INSERT INTO source_ingestion_arrivals (
       organization_id, expectation_id, source_id, version_number, file_name, file_hash,
       source_row_count, accepted_row_count, rejected_row_count, received_at,
       supersedes_arrival_id, classification, validation_status,
       downstream_workflow, evidence, seed_marker
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      organizationId,
      expectationId,
      sourceId,
      version.rows[0].next_version,
      options.fileName,
      fileHash,
      options.rows,
      options.status === "accepted" ? options.rows : 0,
      options.status === "accepted" ? 0 : options.rows,
      options.receivedAt,
      options.supersedes ?? null,
      options.classification,
      options.status,
      options.workflow,
      JSON.stringify({
        synthetic: true,
        seedMarker: marker,
        headers: options.headers,
        missingHeaders: options.missingHeaders ?? [],
        amountTotals: options.amountTotals ?? {},
        diagnostics: options.diagnostics ?? [],
      }),
      marker,
    ],
  );
  await client.query(
    `UPDATE source_ingestion_expectations
     SET status = $3, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [
      organizationId,
      expectationId,
      options.classification === "late" ? "late" : "arrived",
    ],
  );
  return result.rows[0].id;
}

await client.connect();
try {
  await client.query("BEGIN");
  const org = await client.query(
    "SELECT id FROM organizations WHERE slug = 'payops-portfolio'",
  );
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("PayOps organization not found");
  await deleteSeedData(organizationId);

  const sources = [
    ["orders", "Internal order ledger", "internal_ledger", "internal_orders", "manual_upload", "Finance ops"],
    ["gateway", "Gateway transaction export", "razorpay_demo", "gateway_report", "dashboard_export_demo", "Payment ops"],
    ["settlement", "Provider settlement statement", "razorpay_demo", "settlement_statement", "dashboard_export_demo", "Settlement ops"],
    ["bank", "Bank credit statement", "bank_demo", "bank_statement", "manual_upload", "Treasury"],
    ["refunds", "Refund report", "razorpay_demo", "refunds_report", "dashboard_export_demo", "Support ops"],
    ["chargebacks", "Chargeback report", "paytm_demo", "chargebacks_report", "email_demo", "Risk ops"],
  ];
  const sourceIds = {};
  for (const [key, name, provider, kind, transport, owner] of sources) {
    sourceIds[key] = await upsertSource(organizationId, {
      key,
      name,
      provider,
      kind,
      transport,
      owner,
    });
  }

  for (const offset of [-1, 0]) {
    for (const [key] of sources) {
      await expectation(organizationId, sourceIds[key], businessDate(offset), 9, key !== "chargebacks");
    }
  }
  const todayExpectations = await client.query(
    `SELECT expectation.id, source.source_key
     FROM source_ingestion_expectations expectation
     JOIN source_ingestion_sources source ON source.id = expectation.source_id
     WHERE expectation.organization_id = $1 AND expectation.business_date = $2`,
    [organizationId, businessDate(0)],
  );
  const previousExpectations = await client.query(
    `SELECT expectation.id, source.source_key
     FROM source_ingestion_expectations expectation
     JOIN source_ingestion_sources source ON source.id = expectation.source_id
     WHERE expectation.organization_id = $1 AND expectation.business_date = $2`,
    [organizationId, businessDate(-1)],
  );

  for (const row of previousExpectations.rows) {
    await arrival(organizationId, row.id, sourceIds[row.source_key], {
      fileName: `${row.source_key}-clean.csv`,
      content: `${row.source_key},amount\nA,100\nB,200`,
      rows: 2,
      receivedAt: isoFor(-1, 8, 30),
      classification: "on_time",
      status: "accepted",
      workflow: row.source_key === "settlement" ? "settlement_import" : "reconciliation",
      headers: ["order_id", "amount"],
      amountTotals: { amount: 300 },
    });
  }

  const byKey = Object.fromEntries(todayExpectations.rows.map((row) => [row.source_key, row.id]));
  await arrival(organizationId, byKey.orders, sourceIds.orders, {
    fileName: "orders-today.csv",
    content: "order_id,amount,payment_mode\nORD-1,1000,upi\nORD-2,800,card",
    rows: 2,
    receivedAt: isoFor(0, 8, 20),
    classification: "on_time",
    status: "accepted",
    workflow: "reconciliation",
    headers: ["order_id", "amount", "payment_mode"],
    amountTotals: { amount: 1800 },
  });
  await arrival(organizationId, byKey.gateway, sourceIds.gateway, {
    fileName: "gateway-today.csv",
    content: "order_id,gateway_reference,amount,status\nORD-1,GW-1,1000,captured\nORD-2,GW-2,800,captured",
    rows: 2,
    receivedAt: isoFor(0, 11, 20),
    classification: "late",
    status: "accepted",
    workflow: "reconciliation",
    headers: ["order_id", "gateway_reference", "amount", "status"],
    amountTotals: { amount: 1800 },
  });
  const firstSettlement = await arrival(organizationId, byKey.settlement, sourceIds.settlement, {
    fileName: "settlement-v1.csv",
    content: "statement_reference,order_id,net_amount,utr\nSTM-1,ORD-1,980,UTR1",
    rows: 1,
    receivedAt: isoFor(0, 8, 40),
    classification: "partial",
    status: "needs_review",
    workflow: "manual_review",
    headers: ["statement_reference", "order_id", "net_amount", "utr"],
    diagnostics: [{ severity: "warning", code: "partial_file", message: "Expected more than one settlement row." }],
  });
  await arrival(organizationId, byKey.settlement, sourceIds.settlement, {
    fileName: "settlement-v2.csv",
    content: "statement_reference,order_id,net_amount,utr\nSTM-1,ORD-1,980,UTR1\nSTM-1,ORD-2,780,UTR2",
    rows: 2,
    receivedAt: isoFor(0, 9, 10),
    classification: "revised",
    status: "accepted",
    workflow: "settlement_import",
    supersedes: firstSettlement,
    headers: ["statement_reference", "order_id", "net_amount", "utr"],
    amountTotals: { net_amount: 1760 },
  });
  await arrival(organizationId, byKey.chargebacks, sourceIds.chargebacks, {
    fileName: "chargebacks-malformed.csv",
    content: "order_id,amount\nORD-3,200",
    rows: 1,
    receivedAt: isoFor(0, 8, 50),
    classification: "schema_failed",
    status: "needs_review",
    workflow: "manual_review",
    headers: ["order_id", "amount"],
    missingHeaders: ["chargeback_amount", "dispute_reference"],
    diagnostics: [{ severity: "error", code: "missing_required_column", message: "Missing chargeback_amount and dispute_reference." }],
  });

  await client.query(
    `INSERT INTO source_ingestion_events (
       organization_id, actor_name, event_type, details
     ) VALUES ($1,'PayOps seed','control_refreshed',$2)`,
    [organizationId, JSON.stringify({ seedMarker: marker, fictional: true })],
  );
  const snapshotCounts = await client.query(
    `SELECT COUNT(*)::int AS expected_files,
       COUNT(*) FILTER (WHERE arrival.validation_status = 'accepted')::int AS accepted_files,
       COUNT(*) FILTER (WHERE arrival.id IS NULL)::int AS missing_files,
       COUNT(*) FILTER (WHERE expectation.status = 'late')::int AS late_files,
       COUNT(*) FILTER (WHERE arrival.validation_status = 'needs_review')::int AS quarantined_files,
       COUNT(*) FILTER (WHERE expectation.required_for_close AND COALESCE(arrival.validation_status, '') <> 'accepted')::int AS blocking_files,
       COUNT(*) FILTER (WHERE NOT expectation.required_for_close AND COALESCE(arrival.validation_status, '') <> 'accepted')::int AS optional_warnings
     FROM source_ingestion_expectations expectation
     LEFT JOIN LATERAL (
       SELECT validation_status, id FROM source_ingestion_arrivals candidate
       WHERE candidate.organization_id = expectation.organization_id
         AND candidate.expectation_id = expectation.id
       ORDER BY candidate.version_number DESC LIMIT 1
     ) arrival ON TRUE
     WHERE expectation.organization_id = $1 AND expectation.business_date = $2::date`,
    [organizationId, businessDate(0)],
  );
  const counts = snapshotCounts.rows[0];
  await client.query(
    `INSERT INTO source_ingestion_readiness_snapshots (
       organization_id, business_date, verdict, expected_files, accepted_files,
       missing_files, late_files, quarantined_files, blocking_files,
       optional_warnings, blocking_expectation_ids, created_by_name, seed_marker
     ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,'PayOps seed',$11)`,
    [organizationId, businessDate(0), counts.blocking_files > 0 ? "blocked" : "ready",
      counts.expected_files, counts.accepted_files, counts.missing_files,
      counts.late_files, counts.quarantined_files, counts.blocking_files,
      counts.optional_warnings, marker],
  );
  await client.query("COMMIT");
  console.log("Seeded source ingestion control-plane demo data.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

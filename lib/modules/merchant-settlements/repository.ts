import type { PoolClient } from "pg";
import type { Actor } from "@/lib/access";
import { query } from "@/lib/db";
import type {
  MerchantSettlementDetail,
  MerchantSettlementFilters,
  MerchantSettlementListItem,
  MerchantSettlementStatus,
  MerchantSettlementUtrStatus,
} from "@/lib/modules/merchant-settlements/types";
import type { ProviderId, SettlementCycle } from "@/lib/types";

export type MerchantSettlementRefreshClock = {
  now?: Date;
};

type SettlementRow = {
  id: string;
  statement_reference: string;
  merchant_account_id: string;
  merchant_reference: string;
  merchant_name: string;
  provider_id: ProviderId;
  payment_mode: string;
  settlement_cycle: SettlementCycle | "manual";
  status: MerchantSettlementStatus;
  utr: string | null;
  expected_settlement_at: Date;
  actual_settlement_at: Date | null;
  gross_amount: string;
  deduction_amount: string;
  net_amount: string;
  bank_credit_amount: string;
  variance_amount: string;
  utr_match_status: MerchantSettlementUtrStatus;
  classification_evidence?: Record<string, unknown>;
  line_count: number;
  deduction_count: number;
  case_count: number;
  updated_at: Date;
};

export type RefreshCandidate = {
  groupKey: string;
  runId: string;
  providerId: ProviderId;
  paymentMode: string;
  settlementCycle: SettlementCycle | "manual";
  expectedSettlementAt: Date;
  actualSettlementAt: Date | null;
  utr: string | null;
  lines: Array<{
    itemId: string;
    orderId: string;
    gatewayReference: string;
    transactionAt: Date | null;
    paymentMode: string;
    grossAmount: number;
    expectedNet: number | null;
    settledAmount: number | null;
    lineStatus: "included" | "held" | "failed" | "reversed";
  }>;
};

export async function lockMerchantSettlementRefresh(
  client: PoolClient,
  organizationId: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 19019))",
    [organizationId],
  );
}

export async function listRefreshCandidates(
  client: PoolClient,
  organizationId: string,
): Promise<RefreshCandidate[]> {
  const rows = await client.query<{
    run_id: string;
    provider_id: ProviderId;
    item_id: string;
    order_id: string;
    gateway_reference: string;
    payment_mode: string;
    gross_amount: string;
    expected_net: string | null;
    settled_amount: string | null;
    transaction_at: Date | null;
    expected_settlement_at: Date;
    settlement_recorded_at: Date | null;
    settlement_cycle: SettlementCycle | null;
    reconciliation_status: string;
  }>(
    `SELECT run.id AS run_id, run.provider_id, item.id AS item_id,
       item.order_id, item.gateway_reference, item.payment_mode,
       item.order_amount::text AS gross_amount,
       item.expected_net::text AS expected_net,
       item.settled_amount::text AS settled_amount,
       item.transaction_at, item.expected_settlement_at,
       item.settlement_recorded_at, item.settlement_cycle,
       item.reconciliation_status
     FROM reconciliation_items item
     JOIN reconciliation_runs run
       ON run.id = item.run_id
      AND run.organization_id = item.organization_id
     WHERE item.organization_id = $1
       AND item.expected_settlement_at IS NOT NULL
       AND item.reconciliation_status IN ('matched', 'missing_settlement', 'amount_mismatch')
     ORDER BY run.id, item.expected_settlement_at, item.payment_mode, item.id
     FOR UPDATE OF item`,
    [organizationId],
  );

  const grouped = new Map<string, RefreshCandidate>();
  for (const row of rows.rows) {
    const expectedDate = row.expected_settlement_at.toISOString().slice(0, 10);
    const key = [
      row.run_id,
      row.provider_id,
      row.payment_mode,
      row.settlement_cycle ?? "manual",
      expectedDate,
    ].join("|");
    const existing = grouped.get(key);
    const actualSettlementAt = row.settlement_recorded_at;
    const candidate =
      existing ??
      {
        groupKey: key,
        runId: row.run_id,
        providerId: row.provider_id,
        paymentMode: row.payment_mode,
        settlementCycle: row.settlement_cycle ?? "manual",
        expectedSettlementAt: row.expected_settlement_at,
        actualSettlementAt,
        utr: null,
        lines: [],
      };
    candidate.actualSettlementAt = earliestDate(
      candidate.actualSettlementAt,
      actualSettlementAt,
    );
    candidate.lines.push({
      itemId: row.item_id,
      orderId: row.order_id,
      gatewayReference: row.gateway_reference,
      transactionAt: row.transaction_at,
      paymentMode: row.payment_mode,
      grossAmount: Number(row.gross_amount),
      expectedNet: row.expected_net == null ? null : Number(row.expected_net),
      settledAmount:
        row.settled_amount == null ? null : Number(row.settled_amount),
      lineStatus:
        row.reconciliation_status === "missing_settlement"
          ? "held"
          : "included",
    });
    if (!existing) grouped.set(key, candidate);
  }

  return [...grouped.values()].map((candidate) => ({
    ...candidate,
    utr: candidate.actualSettlementAt
      ? syntheticUtr(candidate.providerId, candidate.groupKey)
      : null,
  }));
}

export async function ensureDefaultMerchantAccount(
  client: PoolClient,
  organizationId: string,
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO merchant_accounts (
       organization_id, merchant_reference, display_name
     ) VALUES ($1, 'synthetic-demo-merchant', 'Synthetic Demo Merchant')
     ON CONFLICT (organization_id, merchant_reference)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [organizationId],
  );
  return result.rows[0].id;
}

export async function upsertSettlementBatch(
  client: PoolClient,
  input: {
    organizationId: string;
    merchantAccountId: string;
    candidate: RefreshCandidate;
    grossAmount: number;
    deductionAmount: number;
    netAmount: number;
    bankCreditAmount: number;
    varianceAmount: number;
    status: MerchantSettlementStatus;
    utrMatchStatus: MerchantSettlementUtrStatus;
    classificationEvidence: Record<string, unknown>;
  },
) {
  const reference = buildStatementReference(input.candidate);
  const result = await client.query<{ id: string; inserted: boolean }>(
    `INSERT INTO merchant_settlement_batches (
       organization_id, merchant_account_id, source_run_id,
       statement_reference, provider_id, payment_mode, settlement_cycle,
       status, utr, expected_settlement_at, actual_settlement_at,
       gross_amount, deduction_amount, net_amount, bank_credit_amount,
       variance_amount, utr_match_status, classification_evidence
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )
     ON CONFLICT (organization_id, statement_reference)
     DO UPDATE SET
       status = EXCLUDED.status,
       utr = EXCLUDED.utr,
       actual_settlement_at = EXCLUDED.actual_settlement_at,
       gross_amount = EXCLUDED.gross_amount,
       deduction_amount = EXCLUDED.deduction_amount,
       net_amount = EXCLUDED.net_amount,
       bank_credit_amount = EXCLUDED.bank_credit_amount,
       variance_amount = EXCLUDED.variance_amount,
       utr_match_status = EXCLUDED.utr_match_status,
       classification_evidence = EXCLUDED.classification_evidence,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      input.organizationId,
      input.merchantAccountId,
      input.candidate.runId,
      reference,
      input.candidate.providerId,
      input.candidate.paymentMode,
      input.candidate.settlementCycle,
      input.status,
      input.candidate.utr,
      input.candidate.expectedSettlementAt,
      input.candidate.actualSettlementAt,
      input.grossAmount,
      input.deductionAmount,
      input.netAmount,
      input.bankCreditAmount,
      input.varianceAmount,
      input.utrMatchStatus,
      input.classificationEvidence,
    ],
  );
  return result.rows[0];
}

export async function replaceSettlementChildren(
  client: PoolClient,
  input: {
    organizationId: string;
    batchId: string;
    actor: Actor;
    candidate: RefreshCandidate;
    deductionAmount: number;
    netAmount: number;
    bankCreditAmount: number;
    utrMatchStatus: MerchantSettlementUtrStatus;
    classificationEvidence: Record<string, unknown>;
  },
) {
  await client.query(
    "DELETE FROM merchant_settlement_bank_credits WHERE organization_id = $1 AND batch_id = $2",
    [input.organizationId, input.batchId],
  );
  await client.query(
    "DELETE FROM merchant_settlement_deductions WHERE organization_id = $1 AND batch_id = $2",
    [input.organizationId, input.batchId],
  );
  await client.query(
    "DELETE FROM merchant_settlement_lines WHERE organization_id = $1 AND batch_id = $2",
    [input.organizationId, input.batchId],
  );

  for (const line of input.candidate.lines) {
    await client.query(
      `INSERT INTO merchant_settlement_lines (
         organization_id, batch_id, source_item_id, source_run_id, order_id,
         gateway_reference, transaction_at, payment_mode, gross_amount,
         deduction_amount, net_amount, line_status, evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        input.organizationId,
        input.batchId,
        line.itemId,
        input.candidate.runId,
        line.orderId,
        line.gatewayReference,
        line.transactionAt,
        line.paymentMode,
        line.grossAmount,
        Math.max(
          0,
          line.grossAmount -
            (line.expectedNet ?? line.settledAmount ?? line.grossAmount),
        ),
        line.expectedNet ?? line.settledAmount ?? line.grossAmount,
        line.lineStatus,
        {
          source: "reconciliation_items",
          deterministic: true,
          liveProvider: false,
        },
      ],
    );
  }

  if (input.deductionAmount > 0) {
    await client.query(
      `INSERT INTO merchant_settlement_deductions (
         organization_id, batch_id, deduction_type, amount,
         description, evidence
       ) VALUES ($1,$2,'adjustment',$3,$4,$5)`,
      [
        input.organizationId,
        input.batchId,
        input.deductionAmount,
        "Deterministic synthetic net-settlement adjustment from reconciliation evidence.",
        {
          source: "reconciliation_items.expected_net",
          liveProvider: false,
        },
      ],
    );
  }

  if (input.candidate.utr && input.bankCreditAmount > 0) {
    await client.query(
      `INSERT INTO merchant_settlement_bank_credits (
         organization_id, batch_id, utr, amount, credited_at,
         bank_reference, match_status, evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.organizationId,
        input.batchId,
        input.candidate.utr,
        input.bankCreditAmount,
        input.candidate.actualSettlementAt ?? new Date(),
        `SYN-BANK-${input.candidate.utr}`,
        input.utrMatchStatus === "matched" ? "matched" : "amount_mismatch",
        {
          source: "reconciliation_items.settlement_recorded_at",
          deterministic: true,
          liveBankRail: false,
        },
      ],
    );
  }

  await client.query(
    `INSERT INTO merchant_settlement_events (
       organization_id, batch_id, actor_user_id, actor_name,
       event_type, details
     ) VALUES ($1,$2,$3,$4,'batch_refreshed',$5)`,
    [
      input.organizationId,
      input.batchId,
      input.actor.id,
      input.actor.name,
      {
        lineCount: input.candidate.lines.length,
        utrMatchStatus: input.utrMatchStatus,
        classificationEvidence: input.classificationEvidence,
      },
    ],
  );
}

export async function listMerchantSettlements(
  organizationId: string,
  filters: MerchantSettlementFilters,
) {
  const result = await query<SettlementRow>(
    `${baseSettlementSelect()}
     WHERE batch.organization_id = $1
       AND ($2::text = 'all' OR batch.status = $2)
       AND ($3::text = 'all' OR batch.provider_id = $3)
       AND ($4::text = 'all' OR batch.payment_mode = $4)
     GROUP BY batch.id, merchant.id
     ORDER BY batch.expected_settlement_at DESC, batch.updated_at DESC
     LIMIT 100`,
    [organizationId, filters.status, filters.provider, filters.paymentMode],
  );
  return result.rows.map(mapSettlementRow);
}

export async function getMerchantSettlement(
  id: string,
  organizationId: string,
): Promise<MerchantSettlementDetail | null> {
  const batch = await query<SettlementRow>(
    `${baseSettlementSelect()}
     WHERE batch.organization_id = $1 AND batch.id = $2
     GROUP BY batch.id, merchant.id`,
    [organizationId, id],
  );
  if (!batch.rows[0]) return null;

  const [lines, deductions, bankCredits, caseLinks, events] = await Promise.all([
    query<{
      id: string;
      source_item_id: string | null;
      source_run_id: string | null;
      order_id: string;
      gateway_reference: string;
      transaction_at: Date | null;
      payment_mode: string;
      gross_amount: string;
      deduction_amount: string;
      net_amount: string;
      line_status: "included" | "held" | "failed" | "reversed" | "adjusted";
      evidence: Record<string, unknown>;
    }>(
      `SELECT id, source_item_id, source_run_id, order_id, gateway_reference,
         transaction_at, payment_mode, gross_amount::text,
         deduction_amount::text, net_amount::text, line_status, evidence
       FROM merchant_settlement_lines
       WHERE organization_id = $1 AND batch_id = $2
       ORDER BY created_at, id`,
      [organizationId, id],
    ),
    query<{
      id: string;
      line_id: string | null;
      deduction_type: MerchantSettlementDetail["deductions"][number]["deductionType"];
      direction: MerchantSettlementDetail["deductions"][number]["direction"];
      amount: string;
      tax_amount: string;
      description: string;
      forward_applied: boolean;
      evidence: Record<string, unknown>;
    }>(
      `SELECT id, line_id, deduction_type, direction, amount::text,
         tax_amount::text, description, forward_applied, evidence
       FROM merchant_settlement_deductions
       WHERE organization_id = $1 AND batch_id = $2
       ORDER BY created_at, id`,
      [organizationId, id],
    ),
    query<{
      id: string;
      utr: string;
      amount: string;
      credited_at: Date;
      bank_reference: string;
      match_status: "matched" | "unmatched" | "duplicate" | "amount_mismatch";
      evidence: Record<string, unknown>;
    }>(
      `SELECT id, utr, amount::text, credited_at, bank_reference,
         match_status, evidence
       FROM merchant_settlement_bank_credits
       WHERE organization_id = $1 AND batch_id = $2
       ORDER BY credited_at DESC, id`,
      [organizationId, id],
    ),
    query<{
      id: string;
      case_id: string;
      link_type: MerchantSettlementDetail["caseLinks"][number]["linkType"];
      linked_at: Date;
    }>(
      `SELECT id, case_id, link_type, linked_at
       FROM merchant_settlement_case_links
       WHERE organization_id = $1 AND batch_id = $2
       ORDER BY linked_at DESC, id`,
      [organizationId, id],
    ),
    query<{
      id: string;
      actor_name: string;
      event_type: MerchantSettlementDetail["events"][number]["eventType"];
      details: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, actor_name, event_type, details, created_at
       FROM merchant_settlement_events
       WHERE organization_id = $1 AND batch_id = $2
       ORDER BY created_at DESC, id`,
      [organizationId, id],
    ),
  ]);

  return {
    ...mapSettlementRow(batch.rows[0]),
    classificationEvidence: batch.rows[0].classification_evidence ?? {},
    lines: lines.rows.map((row) => ({
      id: row.id,
      sourceItemId: row.source_item_id,
      sourceRunId: row.source_run_id,
      orderId: row.order_id,
      gatewayReference: row.gateway_reference,
      transactionAt: row.transaction_at?.toISOString() ?? null,
      paymentMode: row.payment_mode,
      grossAmount: Number(row.gross_amount),
      deductionAmount: Number(row.deduction_amount),
      netAmount: Number(row.net_amount),
      lineStatus: row.line_status,
      evidence: row.evidence,
    })),
    deductions: deductions.rows.map((row) => ({
      id: row.id,
      lineId: row.line_id,
      deductionType: row.deduction_type,
      direction: row.direction,
      amount: Number(row.amount),
      taxAmount: Number(row.tax_amount),
      description: row.description,
      forwardApplied: row.forward_applied,
      evidence: row.evidence,
    })),
    bankCredits: bankCredits.rows.map((row) => ({
      id: row.id,
      utr: row.utr,
      amount: Number(row.amount),
      creditedAt: row.credited_at.toISOString(),
      bankReference: row.bank_reference,
      matchStatus: row.match_status,
      evidence: row.evidence,
    })),
    caseLinks: caseLinks.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      linkType: row.link_type,
      linkedAt: row.linked_at.toISOString(),
    })),
    events: events.rows.map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      eventType: row.event_type,
      details: row.details,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

function baseSettlementSelect() {
  return `SELECT batch.id, batch.statement_reference,
       merchant.id AS merchant_account_id,
       merchant.merchant_reference, merchant.display_name AS merchant_name,
       batch.provider_id, batch.payment_mode, batch.settlement_cycle,
       batch.status, batch.utr, batch.expected_settlement_at,
       batch.actual_settlement_at, batch.gross_amount::text,
       batch.deduction_amount::text, batch.net_amount::text,
       batch.bank_credit_amount::text, batch.variance_amount::text,
       batch.utr_match_status, batch.classification_evidence,
       COUNT(DISTINCT line.id)::int AS line_count,
       COUNT(DISTINCT deduction.id)::int AS deduction_count,
       COUNT(DISTINCT case_link.id)::int AS case_count,
       batch.updated_at
     FROM merchant_settlement_batches batch
     JOIN merchant_accounts merchant
       ON merchant.id = batch.merchant_account_id
      AND merchant.organization_id = batch.organization_id
     LEFT JOIN merchant_settlement_lines line
       ON line.batch_id = batch.id
      AND line.organization_id = batch.organization_id
     LEFT JOIN merchant_settlement_deductions deduction
       ON deduction.batch_id = batch.id
      AND deduction.organization_id = batch.organization_id
     LEFT JOIN merchant_settlement_case_links case_link
       ON case_link.batch_id = batch.id
      AND case_link.organization_id = batch.organization_id`;
}

function mapSettlementRow(row: SettlementRow): MerchantSettlementListItem {
  return {
    id: row.id,
    statementReference: row.statement_reference,
    merchant: {
      id: row.merchant_account_id,
      reference: row.merchant_reference,
      name: row.merchant_name,
    },
    providerId: row.provider_id,
    paymentMode: row.payment_mode,
    settlementCycle: row.settlement_cycle,
    status: row.status,
    utr: row.utr,
    expectedSettlementAt: row.expected_settlement_at.toISOString(),
    actualSettlementAt: row.actual_settlement_at?.toISOString() ?? null,
    grossAmount: Number(row.gross_amount),
    deductionAmount: Number(row.deduction_amount),
    netAmount: Number(row.net_amount),
    bankCreditAmount: Number(row.bank_credit_amount),
    varianceAmount: Number(row.variance_amount),
    utrMatchStatus: row.utr_match_status,
    lineCount: row.line_count,
    deductionCount: row.deduction_count,
    caseCount: row.case_count,
    updatedAt: row.updated_at.toISOString(),
  };
}

// Slice 5: load refund deductions for a set of statement_references so
// the refund-allocation hook can recognize refunds that arrived via the
// settlement-imports flow (not via the engine's CSV upload). Returns the
// shape NormalizedRefundRow expects.
export async function loadRefundCandidatesForStatements(
  client: PoolClient,
  organizationId: string,
  statementReferences: string[],
): Promise<
  Array<{
    orderId: string;
    amount: number;
    reference: string;
    settlementAt: string | null;
    transactionAt: string | null;
    utr: string | null;
    statementReference: string | null;
  }>
> {
  if (statementReferences.length === 0) return [];
  const result = await client.query<{
    order_id: string;
    amount: string;
    id: string;
    actual_settlement_at: Date | null;
    transaction_at: Date | null;
    utr: string | null;
    statement_reference: string;
  }>(
    `SELECT line.order_id,
            deduction.amount::text AS amount,
            deduction.id::text AS id,
            batch.actual_settlement_at,
            line.transaction_at,
            batch.utr,
            batch.statement_reference
       FROM merchant_settlement_deductions deduction
       JOIN merchant_settlement_lines line
         ON line.id = deduction.line_id
        AND line.organization_id = deduction.organization_id
       JOIN merchant_settlement_batches batch
         ON batch.id = deduction.batch_id
        AND batch.organization_id = deduction.organization_id
      WHERE deduction.organization_id = $1
        AND batch.statement_reference = ANY($2::text[])
        AND deduction.deduction_type = 'refund'`,
    [organizationId, statementReferences],
  );
  return result.rows.map((row) => ({
    orderId: row.order_id,
    amount: Number(row.amount),
    reference: row.id,
    settlementAt: row.actual_settlement_at?.toISOString() ?? null,
    transactionAt: row.transaction_at?.toISOString() ?? null,
    utr: row.utr,
    statementReference: row.statement_reference,
  }));
}

export function buildStatementReference(candidate: RefreshCandidate) {
  const date = candidate.expectedSettlementAt.toISOString().slice(0, 10);
  return [
    "MSS",
    candidate.providerId,
    candidate.paymentMode.replace(/[^a-z0-9]+/gi, "-").toUpperCase(),
    date,
    candidate.runId.slice(0, 8),
  ].join("-");
}

function syntheticUtr(providerId: ProviderId, key: string) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `SYN${providerId.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase()}${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

function earliestDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

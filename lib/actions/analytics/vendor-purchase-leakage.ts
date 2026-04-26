"use server"

/**
 * Vendor-side mirror of the facility's per-purchase compliance audit
 * (v0 doc §5). Where the facility view answers "how compliant are
 * MY purchases?", this view answers "where is MY product being
 * bought off the contract I'm a party to?". Useful for vendors
 * pursuing under-utilized contracts.
 *
 * Each row = a COG record with this vendor's product where the
 * facility either had no active contract for the line, the contract
 * had expired by the purchase date, or the unit price diverged
 * meaningfully from the contracted price (v0 banding).
 *
 * Implementation note: classification is pushed into a single SQL
 * query. The previous in-memory loop pulled up to 25k rows + per-
 * facility contracts/pricing into Node and looped. The SQL version
 * does the join in Postgres, classifies via CASE, and returns
 * already-classified rows — drops both round-trip count and Node
 * memory pressure. v0 banding constants (±5% significant, ±0.5%
 * at-contract) are inlined here to keep the SQL self-contained;
 * `lib/v0-spec/cog.ts` remains the test oracle that unit tests
 * pin against.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { type V0CogVarianceBand } from "@/lib/v0-spec/cog"

export type LeakageReason =
  | "OFF_CONTRACT"
  | "OUT_OF_PERIOD"
  | "PRICE_VARIANCE"

export interface LeakageRow {
  cogId: string
  facilityId: string
  facilityName: string
  vendorItemNo: string | null
  inventoryDescription: string | null
  transactionDate: string
  unitCost: number
  quantity: number
  extendedPrice: number
  reason: LeakageReason
  band: V0CogVarianceBand | null
  contractPrice: number | null
  variancePct: number | null
}

export interface VendorPurchaseLeakageReport {
  totalRows: number
  byReason: Record<LeakageReason, number>
  rows: LeakageRow[]
}

interface RawLeakageRow {
  cog_id: string
  facility_id: string
  facility_name: string
  vendor_item_no: string | null
  inventory_description: string | null
  transaction_date: Date
  unit_cost: Prisma.Decimal
  quantity: number
  extended_price: Prisma.Decimal | null
  reason: LeakageReason
  band: V0CogVarianceBand | null
  contract_price: Prisma.Decimal | null
  variance_pct: number | null
}

export async function getVendorPurchaseLeakage(input: {
  fromDate: string
  toDate: string
  /** Max rows returned in the response (after classification). */
  rowLimit?: number
}): Promise<VendorPurchaseLeakageReport> {
  const { vendor } = await requireVendor()
  const from = new Date(input.fromDate)
  const to = new Date(input.toDate)
  const rowLimit = input.rowLimit ?? 250

  // Single-query classification. For each COG row attributed to this
  // vendor in window:
  //   1. LATERAL pick of the matching active in-period contract
  //      pricing line (vendor + facility + item + period). Returns
  //      NULL fields when nothing matches.
  //   2. CASE WHEN cascade (off-contract → out-of-period →
  //      price-variance band).
  //   3. Filter to rows whose reason isn't NULL (no leakage).
  // Counts come from the same recordset post-truncation; we WINDOW
  // OVER () to get them in one shot before LIMIT.
  const rawRows = await prisma.$queryRaw<RawLeakageRow[]>`
    WITH cog AS (
      SELECT c.id          AS cog_id,
             c."facilityId" AS facility_id,
             c."vendorItemNo" AS vendor_item_no,
             c."inventoryDescription" AS inventory_description,
             c."transactionDate" AS transaction_date,
             c."unitCost"   AS unit_cost,
             c.quantity     AS quantity,
             c."extendedPrice" AS extended_price
      FROM cog_record c
      WHERE c."vendorId" = ${vendor.id}
        AND c."transactionDate" >= ${from}
        AND c."transactionDate" <= ${to}
    ),
    classified AS (
      SELECT
        cog.*,
        f.name AS facility_name,
        match.unit_price AS contract_price,
        any_active.has_any AS has_any_contract,
        any_in_period.has_any AS has_in_period_contract,
        CASE
          WHEN any_active.has_any IS NULL THEN 'OFF_CONTRACT'::text
          WHEN any_in_period.has_any IS NULL THEN 'OUT_OF_PERIOD'::text
          WHEN match.unit_price IS NOT NULL
               AND ABS((cog.unit_cost - match.unit_price) / match.unit_price) >= 0.05
            THEN 'PRICE_VARIANCE'::text
          ELSE NULL
        END AS reason,
        CASE
          WHEN match.unit_price IS NOT NULL THEN
            ROUND(((cog.unit_cost - match.unit_price) / match.unit_price) * 100, 2)
          ELSE NULL
        END AS variance_pct
      FROM cog
      LEFT JOIN facility f ON f.id = cog.facility_id
      -- Has ANY active contract with this facility?
      LEFT JOIN LATERAL (
        SELECT 1 AS has_any
        FROM contract ctr
        WHERE ctr."vendorId" = ${vendor.id}
          AND ctr."facilityId" = cog.facility_id
          AND ctr.status = 'active'
        LIMIT 1
      ) any_active ON TRUE
      -- Has an in-period active contract on the COG date?
      LEFT JOIN LATERAL (
        SELECT 1 AS has_any
        FROM contract ctr
        WHERE ctr."vendorId" = ${vendor.id}
          AND ctr."facilityId" = cog.facility_id
          AND ctr.status = 'active'
          AND ctr."effectiveDate"  <= cog.transaction_date
          AND ctr."expirationDate" >= cog.transaction_date
        LIMIT 1
      ) any_in_period ON TRUE
      -- Best matching contract price for the item.
      LEFT JOIN LATERAL (
        SELECT cp."unitPrice" AS unit_price
        FROM contract ctr
        JOIN contract_pricing cp ON cp."contractId" = ctr.id
        WHERE ctr."vendorId" = ${vendor.id}
          AND ctr."facilityId" = cog.facility_id
          AND ctr.status = 'active'
          AND ctr."effectiveDate"  <= cog.transaction_date
          AND ctr."expirationDate" >= cog.transaction_date
          AND cp."vendorItemNo" = cog.vendor_item_no
        LIMIT 1
      ) match ON TRUE
    )
    SELECT
      cog_id,
      facility_id,
      facility_name,
      vendor_item_no,
      inventory_description,
      transaction_date,
      unit_cost,
      quantity,
      extended_price,
      reason::text AS reason,
      CASE
        WHEN reason = 'PRICE_VARIANCE' AND variance_pct >= 5  THEN 'significant_overcharge'
        WHEN reason = 'PRICE_VARIANCE' AND variance_pct <= -5 THEN 'significant_discount'
        ELSE NULL
      END AS band,
      contract_price,
      variance_pct
    FROM classified
    WHERE reason IS NOT NULL
      AND facility_id IS NOT NULL
    ORDER BY transaction_date DESC
    LIMIT ${rowLimit}
  `

  // Counts come from a separate cheap aggregate over the same
  // population so totalRows/byReason reflect the full window even
  // when rowLimit truncates the response payload.
  const countResult = await prisma.$queryRaw<
    Array<{ reason: string; n: bigint }>
  >`
    WITH cog AS (
      SELECT c.id, c."facilityId", c."vendorItemNo", c."unitCost", c."transactionDate"
      FROM cog_record c
      WHERE c."vendorId" = ${vendor.id}
        AND c."transactionDate" >= ${from}
        AND c."transactionDate" <= ${to}
        AND c."facilityId" IS NOT NULL
    )
    SELECT reason, COUNT(*)::bigint AS n FROM (
      SELECT
        CASE
          WHEN any_active.has_any IS NULL THEN 'OFF_CONTRACT'
          WHEN any_in_period.has_any IS NULL THEN 'OUT_OF_PERIOD'
          WHEN match.unit_price IS NOT NULL
               AND ABS((cog."unitCost" - match.unit_price) / match.unit_price) >= 0.05
            THEN 'PRICE_VARIANCE'
          ELSE NULL
        END AS reason
      FROM cog
      LEFT JOIN LATERAL (
        SELECT 1 AS has_any FROM contract ctr
        WHERE ctr."vendorId" = ${vendor.id}
          AND ctr."facilityId" = cog."facilityId"
          AND ctr.status = 'active'
        LIMIT 1
      ) any_active ON TRUE
      LEFT JOIN LATERAL (
        SELECT 1 AS has_any FROM contract ctr
        WHERE ctr."vendorId" = ${vendor.id}
          AND ctr."facilityId" = cog."facilityId"
          AND ctr.status = 'active'
          AND ctr."effectiveDate"  <= cog."transactionDate"
          AND ctr."expirationDate" >= cog."transactionDate"
        LIMIT 1
      ) any_in_period ON TRUE
      LEFT JOIN LATERAL (
        SELECT cp."unitPrice" AS unit_price
        FROM contract ctr
        JOIN contract_pricing cp ON cp."contractId" = ctr.id
        WHERE ctr."vendorId" = ${vendor.id}
          AND ctr."facilityId" = cog."facilityId"
          AND ctr.status = 'active'
          AND ctr."effectiveDate"  <= cog."transactionDate"
          AND ctr."expirationDate" >= cog."transactionDate"
          AND cp."vendorItemNo" = cog."vendorItemNo"
        LIMIT 1
      ) match ON TRUE
    ) sub
    WHERE reason IS NOT NULL
    GROUP BY reason
  `

  const counts: Record<LeakageReason, number> = {
    OFF_CONTRACT: 0,
    OUT_OF_PERIOD: 0,
    PRICE_VARIANCE: 0,
  }
  let totalRows = 0
  for (const r of countResult) {
    const k = r.reason as LeakageReason
    if (k in counts) {
      counts[k] = Number(r.n)
      totalRows += Number(r.n)
    }
  }

  const rows: LeakageRow[] = rawRows.map((r) => ({
    cogId: r.cog_id,
    facilityId: r.facility_id,
    facilityName: r.facility_name ?? r.facility_id,
    vendorItemNo: r.vendor_item_no,
    inventoryDescription: r.inventory_description,
    transactionDate: new Date(r.transaction_date).toISOString(),
    unitCost: Number(r.unit_cost),
    quantity: r.quantity,
    extendedPrice: r.extended_price == null ? 0 : Number(r.extended_price),
    reason: r.reason,
    band: r.band,
    contractPrice: r.contract_price == null ? null : Number(r.contract_price),
    variancePct: r.variance_pct == null ? null : Number(r.variance_pct),
  }))

  return serialize({
    totalRows,
    byReason: counts,
    rows,
  })
}

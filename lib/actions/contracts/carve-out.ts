"use server"

/**
 * Carve-out rebate adapter + server action — roadmap W1.Z-A.
 *
 * Wires the tested `lib/rebates/engine/carve-out.ts` to the Prisma
 * data model. Reads ContractPricing rows with a non-null
 * carveOutPercent (Charles N17's column), builds a CarveOutConfig,
 * pulls COG purchases for the contract, and runs the engine.
 *
 * Return shape is the canonical engine's RebateResult with
 * `carveOutLines[]` — one result per carved-out SKU showing spend,
 * units, and line rebate. Zero-rate / zero-spend lines omitted
 * upstream by the engine.
 *
 * Reference: `docs/superpowers/specs/2026-04-20-canonical-rebate-engine-gap-design.md`
 * track W1.Z-A.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { calculateCarveOut } from "@/lib/rebates/engine/carve-out"
import type {
  CarveOutConfig,
  PeriodData,
  PurchaseRecord,
  RebateResult,
} from "@/lib/rebates/engine/types"
import { serialize } from "@/lib/serialize"

/**
 * Returns the current carve-out rebate state for a contract. Callers:
 * the contract-detail Rebates tab (display), the dashboard carve-out
 * drill-down, and anywhere reporting wants the line-level breakdown.
 *
 * Semantics:
 *   - Pulls every `ContractPricing` row for the contract that has a
 *     non-null `carveOutPercent`. Each becomes a CarveOutLineConfig.
 *   - Pulls every matched COG record for the contract (matchStatus
 *     IN on_contract / price_variance) and wraps as PurchaseRecord.
 *   - Delegates to `calculateCarveOut` in the canonical engine.
 *
 * Returns `{ type: "CARVE_OUT", rebateEarned: 0, carveOutLines: [] }`
 * when the contract has no carve-out rows configured.
 */
export async function getCarveOutRebate(
  contractId: string,
): Promise<RebateResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true, vendorId: true },
  })

  const [pricingItems, cogRecords] = await Promise.all([
    prisma.contractPricing.findMany({
      where: {
        contractId: contract.id,
        carveOutPercent: { not: null },
      },
      select: {
        vendorItemNo: true,
        carveOutPercent: true,
      },
    }),
    prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        OR: [
          { contractId: contract.id },
          { contractId: null, vendorId: contract.vendorId },
        ],
        matchStatus: { in: ["on_contract", "price_variance"] },
      },
      select: {
        vendorItemNo: true,
        quantity: true,
        unitCost: true,
        extendedPrice: true,
        transactionDate: true,
        category: true,
      },
    }),
  ])

  const lines: CarveOutConfig["lines"] = pricingItems
    .filter((p) => p.carveOutPercent !== null)
    .map((p) => ({
      referenceNumber: p.vendorItemNo,
      rateType: "PERCENT_OF_SPEND" as const,
      rebatePercent: Number(p.carveOutPercent),
    }))

  // Empty-case short-circuit: keep the engine call for shape
  // consistency, but skip the COG scan when there's nothing to compute.
  if (lines.length === 0) {
    const empty = calculateCarveOut(
      { type: "CARVE_OUT", lines: [] },
      { purchases: [], totalSpend: 0, periodLabel: "no carve-out lines" },
    )
    return serialize(empty)
  }

  const purchases: PurchaseRecord[] = cogRecords
    .filter(
      (r): r is typeof r & { vendorItemNo: string } =>
        r.vendorItemNo !== null,
    )
    .map((r) => ({
      referenceNumber: r.vendorItemNo,
      productCategory: r.category,
      quantity: r.quantity,
      unitPrice: Number(r.unitCost),
      extendedPrice: Number(r.extendedPrice ?? 0),
      purchaseDate: r.transactionDate,
    }))

  const totalSpend = purchases.reduce((s, p) => s + p.extendedPrice, 0)
  const periodData: PeriodData = {
    purchases,
    totalSpend,
    periodLabel: null,
  }

  const config: CarveOutConfig = { type: "CARVE_OUT", lines }
  const result = calculateCarveOut(config, periodData)
  return serialize(result)
}

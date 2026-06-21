"use server"

/**
 * Reports hub — Calculation audit trail data action.
 *
 * Thin facility wrapper for the "how was this rebate computed" payload on
 * the Calculations tab. Gate (`requireFacility`) → scope ownership
 * (`contractOwnershipWhere`) → load the contract + its PO lines → delegate
 * ALL shaping/math to the shared pure core `buildRebateCalcAudit`
 * (`lib/reports/coverage.ts`), which the vendor mirror also uses so the two
 * surfaces can never drift.
 *
 * The PO scope is the facility's own COG (purchaseOrder.facilityId =
 * facility.id) for this contract's vendor.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { buildRebateCalcAudit } from "@/lib/reports/coverage"
import type { RebateCalcAudit } from "@/lib/reports/audit-trail"

/**
 * Return the full audit trail for a single contract, scoped to the
 * caller's active facility.
 *
 * Ownership is enforced by `contractOwnershipWhere` — a facility that
 * doesn't own (and isn't shared on) this contract will hit a NotFound.
 */
export async function getRebateCalculationAudit(
  contractId: string,
): Promise<RebateCalcAudit> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      vendor: { select: { id: true, name: true } },
      terms: {
        orderBy: { effectiveStart: "asc" },
        include: {
          tiers: { orderBy: { tierNumber: "asc" } },
        },
      },
      pricingItems: {
        select: {
          vendorItemNo: true,
          effectiveDate: true,
          expirationDate: true,
        },
      },
    },
  })

  // PO lines for this vendor + facility.
  const poLines = await prisma.pOLineItem.findMany({
    where: {
      purchaseOrder: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
      },
    },
    include: {
      purchaseOrder: {
        select: { poNumber: true, orderDate: true },
      },
    },
  })

  return serialize(buildRebateCalcAudit(contract, poLines))
}

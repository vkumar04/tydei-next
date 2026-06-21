"use server"

/**
 * Vendor reports — Calculation audit trail data action.
 *
 * Vendor-scoped mirror of `getRebateCalculationAudit`
 * (`lib/actions/reports/audit-trail.ts`). Thin vendor wrapper: gate
 * (`requireVendor`) → scope ownership (`contractOwnershipWhereVendor`) →
 * load the contract + its PO lines → delegate ALL shaping/math to the same
 * shared pure core `buildRebateCalcAudit` (`lib/reports/coverage.ts`).
 * Returns the byte-identical `RebateCalcAudit` shape the facility action
 * returns — the shared presentational Calculations tab depends on it.
 *
 * The PO scope is the matched contract's OWN `facilityId` (COG is
 * per-facility; a contract belongs to exactly one facility) AND the
 * contract's primary `vendorId` — keeping the audit numbers consistent
 * with the facility-side surfaces for the same contract.
 */
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhereVendor } from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import { buildRebateCalcAudit } from "@/lib/reports/coverage"
import type { RebateCalcAudit } from "@/lib/reports/audit-trail"

/**
 * Return the full audit trail for a single contract, scoped to the
 * caller's active vendor.
 *
 * Ownership is enforced by `contractOwnershipWhereVendor` — a vendor that
 * doesn't own (and isn't a grouped participant on) this contract will
 * not match and the action throws a digest-safe NotFound.
 */
export async function getVendorRebateCalculationAudit(
  contractId: string,
): Promise<RebateCalcAudit> {
  const { vendor } = await requireVendor()

  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhereVendor(contractId, vendor.id),
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

  if (!contract) {
    throw new Error("Contract not found")
  }

  // PO lines for this contract's facility + vendor. The audit is for ONE
  // contract that belongs to ONE facility, so the COG spend is scoped by
  // the matched contract's `facilityId` AND the contract's primary
  // `vendorId`. Contract.facilityId is nullable on the vendor side; coerce
  // null → undefined so the PO filter stays a valid string filter (a
  // facility-less contract simply isn't facility-scoped here).
  const poLines = await prisma.pOLineItem.findMany({
    where: {
      purchaseOrder: {
        facilityId: contract.facilityId ?? undefined,
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

/**
 * Bundle compute layer — joins the `TieInBundle` DB model to the pure
 * math in `lib/contracts/tie-in-compliance.ts` (which is oracle-locked
 * against `lib/v0-spec/tie-in.ts`).
 *
 * Flow per bundle:
 *   1. Resolve each member's spend from COG rows in the bundle's
 *      active window.
 *      - contractId set  → sum spend where cr.contractId === member.contractId
 *      - cross-vendor    → sum spend where cr.vendorId === member.vendorId
 *   2. Route to the right compliance computer based on the bundle's
 *      complianceMode.
 *   3. Return a shape the UI can render directly.
 *
 * Kept separate from `lib/actions/contracts/tie-in.ts` so this module
 * stays "use server"-free and can be imported by tests / the oracle.
 */

import type { Prisma, PrismaClient } from "@prisma/client"
import {
  computeTieInAllOrNothing,
  computeTieInProportional,
  computeCrossVendorTieIn,
  type TieInAllOrNothingResult,
  type TieInProportionalResult,
  type CrossVendorResult,
} from "@/lib/contracts/tie-in-compliance"

type PrismaLike = PrismaClient | Prisma.TransactionClient

export interface BundleComputeResult {
  bundleId: string
  complianceMode: "all_or_nothing" | "proportional" | "cross_vendor"
  allOrNothing?: TieInAllOrNothingResult
  proportional?: TieInProportionalResult
  crossVendor?: CrossVendorResult
}

/**
 * Load a bundle from the DB, resolve each member's current spend, and
 * compute the compliance result via the v0-aligned pure helpers.
 *
 * `facilityId` scopes COG aggregation — same semantics as every other
 * canonical reducer in the codebase (see CLAUDE.md invariants table).
 */
export async function computeBundleStatus(
  db: PrismaLike,
  bundleId: string,
  facilityId: string,
): Promise<BundleComputeResult | null> {
  const bundle = await db.tieInBundle.findUnique({
    where: { id: bundleId },
    include: {
      members: {
        include: {
          contract: { select: { id: true, vendorId: true, name: true } },
        },
      },
    },
  })
  if (!bundle) return null

  const windowStart = bundle.effectiveStart ?? null
  const windowEnd = bundle.effectiveEnd ?? null

  const sumSpendForMember = async (member: {
    contractId: string | null
    vendorId: string | null
    contract: { vendorId: string | null } | null
  }): Promise<number> => {
    const where: Prisma.COGRecordWhereInput = { facilityId }
    if (member.contractId) {
      where.contractId = member.contractId
    } else if (member.vendorId) {
      where.vendorId = member.vendorId
    } else if (member.contract?.vendorId) {
      where.vendorId = member.contract.vendorId
    } else {
      return 0
    }
    if (windowStart || windowEnd) {
      where.transactionDate = {
        ...(windowStart ? { gte: windowStart } : {}),
        ...(windowEnd ? { lte: windowEnd } : {}),
      }
    }
    const agg = await db.cOGRecord.aggregate({
      where,
      _sum: { extendedPrice: true },
    })
    return Number(agg._sum.extendedPrice ?? 0)
  }

  const memberSpends = await Promise.all(
    bundle.members.map((m) => sumSpendForMember(m)),
  )

  if (bundle.complianceMode === "all_or_nothing") {
    const result = computeTieInAllOrNothing(
      bundle.members.map((m, i) => ({
        minimumSpend: Number(m.minimumSpend ?? 0),
        currentSpend: memberSpends[i]!,
      })),
      {
        baseRate: Number(bundle.baseRate ?? 0),
        bonusRate: bundle.bonusRate != null ? Number(bundle.bonusRate) : undefined,
        acceleratorMultiplier:
          bundle.acceleratorMultiplier != null
            ? Number(bundle.acceleratorMultiplier)
            : bundle.bonusMultiplier != null
              ? Number(bundle.bonusMultiplier)
              : undefined,
      },
    )
    return {
      bundleId,
      complianceMode: "all_or_nothing",
      allOrNothing: result,
    }
  }

  if (bundle.complianceMode === "proportional") {
    const result = computeTieInProportional(
      bundle.members.map((m, i) => ({
        minimumSpend: Number(m.minimumSpend ?? 0),
        currentSpend: memberSpends[i]!,
        weight: Number(m.weightPercent) / 100,
      })),
      Number(bundle.baseRate ?? 0),
    )
    return {
      bundleId,
      complianceMode: "proportional",
      proportional: result,
    }
  }

  // cross_vendor
  const result = computeCrossVendorTieIn(
    bundle.members.map((m, i) => ({
      vendorId:
        m.vendorId ?? m.contract?.vendorId ?? `member-${i}`,
      vendorName: m.contract?.name ?? m.vendorId ?? `Member ${i + 1}`,
      minimumSpend: Number(m.minimumSpend ?? 0),
      rebateContribution: Number(m.rebateContribution ?? 0),
      currentSpend: memberSpends[i]!,
    })),
    {
      rate: Number(bundle.facilityBonusRate ?? 0),
      requirement:
        bundle.facilityBonusRate != null ? "all_compliant" : "none",
    },
  )
  return {
    bundleId,
    complianceMode: "cross_vendor",
    crossVendor: result,
  }
}

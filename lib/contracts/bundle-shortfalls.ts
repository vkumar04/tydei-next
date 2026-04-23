/**
 * Canonical bundle-shortfall reducer.
 *
 * One helper owns the "which members are below minimum?" derivation
 * across every surface that renders a bundle-shortfall number
 * (dashboard card, alert synthesizer, future compliance reports).
 *
 * Rationale: when the same invariant lives in two places, the two
 * places drift. See Charles W1.R for the real-world precedent. Every
 * surface that wants a shortfall answer calls `deriveBundleShortfalls`;
 * the output shape is stable and carries enough context for both
 * dashboard cards and alert bodies.
 *
 * PURE: no Prisma imports. Fed by the DB-agnostic compute result from
 * `lib/contracts/bundle-compute.ts`.
 */

import type { BundleComputeResult } from "@/lib/contracts/bundle-compute"

export interface BundleMemberShortfall {
  entityId: string
  entityName: string
  currentSpend: number
  minimumSpend: number
  shortfall: number
}

export interface BundleShortfallResult {
  bundleId: string
  bundleLabel: string
  complianceMode: "all_or_nothing" | "proportional" | "cross_vendor"
  memberCount: number
  members: BundleMemberShortfall[]
  shortfallCount: number
  largestShortfall: number
  /** True when at least one member is below minimum spend. */
  hasShortfalls: boolean
}

export interface BundleShortfallInput {
  bundleId: string
  bundleLabel: string
  /**
   * Persisted members — provides names and the total count. The
   * compute result alone doesn't carry labels for all_or_nothing/
   * proportional modes, so surfaces that want a label need this.
   */
  members: Array<{
    contractId: string | null
    vendorId: string | null
    minimumSpend: number | null
    contractName?: string | null
    vendorName?: string | null
  }>
  status: BundleComputeResult
}

/**
 * Reduce a single bundle's compute result + persisted members to a
 * shortfall summary. Callers that have a batch of bundles can map
 * over this helper and filter by `hasShortfalls`.
 */
export function deriveBundleShortfalls(
  input: BundleShortfallInput,
): BundleShortfallResult {
  const { bundleId, bundleLabel, members: dbMembers, status } = input
  const complianceMode = status.complianceMode
  const memberCount = dbMembers.length

  const members: BundleMemberShortfall[] = []

  if (status.allOrNothing) {
    // shortfalls are indexed against the DB-member order as persisted.
    const shortfallByIndex = new Map<number, number>()
    for (const s of status.allOrNothing.shortfalls) {
      shortfallByIndex.set(s.index, s.shortfall)
    }
    dbMembers.forEach((m, i) => {
      const min = m.minimumSpend ?? 0
      const shortfall = shortfallByIndex.get(i) ?? 0
      const currentSpend = Math.max(0, min - shortfall)
      members.push({
        entityId: m.contractId ?? m.vendorId ?? "",
        entityName:
          m.contractName ?? m.vendorName ?? "Unknown",
        currentSpend,
        minimumSpend: min,
        shortfall,
      })
    })
  } else if (status.crossVendor) {
    for (const v of status.crossVendor.perVendor) {
      members.push({
        entityId: v.vendorId,
        entityName: v.vendorName,
        currentSpend: v.spend,
        minimumSpend: v.spend + (v.shortfall ?? 0),
        shortfall: v.shortfall ?? 0,
      })
    }
  } else if (status.proportional) {
    // Proportional compute doesn't expose per-member spend directly.
    // Without spend-per-member we can't attribute shortfall to
    // individual members; surface the aggregate `lostRebate` as a
    // single signal row so the hasShortfalls boolean is meaningful.
    if (status.proportional.lostRebate > 0) {
      members.push({
        entityId: bundleId,
        entityName: "Weighted compliance",
        currentSpend: status.proportional.totalSpend,
        // minimumSpend chosen so shortfall = lostRebate for display
        // consistency; it's a derived aggregate, not a real minimum.
        minimumSpend:
          status.proportional.totalSpend + status.proportional.lostRebate,
        shortfall: status.proportional.lostRebate,
      })
    }
  }

  const below = members.filter((m) => m.shortfall > 0)
  const largestShortfall = below.reduce(
    (max, m) => Math.max(max, m.shortfall),
    0,
  )

  return {
    bundleId,
    bundleLabel,
    complianceMode,
    memberCount,
    members,
    shortfallCount: below.length,
    largestShortfall,
    hasShortfalls: below.length > 0,
  }
}

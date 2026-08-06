"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules. The
// MergedContract row type + mapPendingStatus live in
// lib/contracts/merged-contract.ts (pure, non-directive module).

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import {
  mapPendingStatus,
  type MergedContract,
} from "@/lib/contracts/merged-contract"

// ─── Merged List (system + vendor-submitted pending) ─────────────
//
// Returns both system Contract rows and vendor-submitted PendingContract
// rows in a single array with a typed `source` discriminator. Used by
// the facility contracts list page (contracts-list-closure §4.0).

export async function getMergedContracts(options?: {
  /**
   * Optional 3-way facility filter (canonical doc §7). When set:
   * - System contracts match `facilityId == filter` OR any
   *   ContractFacility row has `facilityId == filter`.
   * - Vendor-submitted pending contracts match on `facilityId == filter`
   *   only (PendingContract has no multi-facility join yet).
   */
  facilityFilter?: string | null
}) {
  const { facility } = await requireFacility()
  const facilityFilter = options?.facilityFilter ?? null

  // Build the system-contracts where clause — base ownership + optional
  // 3-way filter narrowing.
  const systemWhere: Prisma.ContractWhereInput = {
    AND: [
      contractsOwnedByFacility(facility.id),
      ...(facilityFilter
        ? [
            {
              OR: [
                { facilityId: facilityFilter },
                { contractFacilities: { some: { facilityId: facilityFilter } } },
              ],
            },
          ]
        : []),
    ],
  }

  const pendingWhere: Prisma.PendingContractWhereInput = {
    facilityId: facilityFilter ?? facility.id,
    status: { in: ["submitted", "revision_requested", "rejected", "draft"] },
  }

  const [systemContracts, pendingContracts] = await Promise.all([
    prisma.contract.findMany({
      where: systemWhere,
      include: {
        vendor: { select: { id: true, name: true } },
        contractFacilities: { select: { facilityId: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.pendingContract.findMany({
      where: pendingWhere,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { submittedAt: "desc" },
    }),
  ])

  const systemRows: MergedContract[] = systemContracts.map((c) => ({
    id: `system:${c.id}`,
    contractId: c.id,
    name: c.name,
    source: "system",
    status: c.status,
    vendor: { id: c.vendor.id, name: c.vendor.name },
    contractType: c.contractType,
    facilityId: c.facilityId,
    facilities: Array.from(
      new Set([
        ...(c.facilityId ? [c.facilityId] : []),
        ...c.contractFacilities.map((cf) => cf.facilityId),
      ]),
    ),
    effectiveDate: c.effectiveDate,
    expirationDate: c.expirationDate,
    totalValue: Number(c.totalValue),
    // Contract.score doesn't exist on the current schema; reserved for
    // future contracts-rewrite scoring subsystem. Always null for now.
    score: null,
  }))

  const vendorRows: MergedContract[] = pendingContracts
    .map((p): MergedContract | null => {
      const mapped = mapPendingStatus(p.status)
      if (mapped === null) return null
      return {
        id: `vendor:${p.id}`,
        contractId: null,
        name: p.contractName,
        source: "vendor",
        status: mapped,
        vendor: { id: p.vendor.id, name: p.vendor.name },
        contractType: p.contractType,
        facilityId: p.facilityId,
        facilities: p.facilityId ? [p.facilityId] : [],
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        totalValue: Number(p.totalValue ?? 0),
        score: null,
      }
    })
    .filter((x): x is MergedContract => x !== null)

  return serialize([...systemRows, ...vendorRows])
}

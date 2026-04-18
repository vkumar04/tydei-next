"use server"

/**
 * Contracts-list facility filter — dropdown data source.
 *
 * Per docs/superpowers/specs/2026-04-18-contracts-list-closure.md §4.3.
 *
 * Builds the unique list of facilities for the 3-way filter dropdown
 * on the contracts list page:
 *   - Active facilities from the facility registry
 *   - UNION with facilities referenced on any ContractFacility row
 *     for contracts owned by this caller's facility (siblings in a
 *     multi-facility contract should appear even if they're not in
 *     the primary "active" registry).
 *   - Deduped by facilityId, sorted by name asc.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface AvailableFacility {
  id: string
  name: string
  /** True when this is the caller's own facility. */
  isCurrent: boolean
}

export async function getAvailableFacilitiesForContractFilter(): Promise<
  AvailableFacility[]
> {
  const { facility } = await requireFacility()

  // Pass 1 — every facility in the registry (healthcare system-wide
  // view typically shows all; solo facilities see only themselves).
  const activeFacilities = await prisma.facility.findMany({
    where: {
      // Scope to this facility's health system (or this facility alone
      // when health-system is null).
      OR: [
        { id: facility.id },
        { healthSystemId: facility.healthSystemId ?? "" },
      ],
    },
    select: { id: true, name: true },
  })

  // Pass 2 — facilities referenced on any ContractFacility row for
  // contracts owned by the caller. Multi-facility contracts might
  // span facilities not in the active registry (e.g., deactivated
  // but still linked).
  const joined = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: {
      contractFacilities: {
        select: {
          facility: { select: { id: true, name: true } },
        },
      },
    },
  })

  // Dedupe by id; first-seen wins.
  const seen = new Map<string, { id: string; name: string }>()
  for (const f of activeFacilities) seen.set(f.id, f)
  for (const c of joined) {
    for (const cf of c.contractFacilities) {
      if (!seen.has(cf.facility.id)) seen.set(cf.facility.id, cf.facility)
    }
  }

  const result: AvailableFacility[] = Array.from(seen.values())
    .map((f) => ({
      id: f.id,
      name: f.name,
      isCurrent: f.id === facility.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return serialize(result)
}

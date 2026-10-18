"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { healthSystemFacilityIds } from "@/lib/contracts/health-system-facilities"
import { serialize } from "@/lib/serialize"

// ─── List Facilities ─────────────────────────────────────────────
//
// Thin list-action used by the contract-create multi-facility picker
// (and any future facility-scoped selector). Returns only the fields
// needed for a dropdown / checkbox list — id + name. Limited to the
// caller's health system: a contract can only be shared with those.

export interface FacilityOption {
  id: string
  name: string
}

export async function getFacilities(): Promise<FacilityOption[]> {
  const { facility } = await requireFacility()
  const allowed = await healthSystemFacilityIds(facility)

  const facilities = await prisma.facility.findMany({
    where: { status: "active", id: { in: [...allowed] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return serialize(facilities)
}

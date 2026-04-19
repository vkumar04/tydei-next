"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── List Facilities ─────────────────────────────────────────────
//
// Thin list-action used by the contract-create multi-facility picker
// (and any future facility-scoped selector). Returns only the fields
// needed for a dropdown / checkbox list — id + name. Gated on
// requireAuth() since facility rows are not facility-scoped (any
// authenticated user may see the list of facilities they might
// attach a contract to).

export interface FacilityOption {
  id: string
  name: string
}

export async function getFacilities(): Promise<FacilityOption[]> {
  await requireAuth()

  const facilities = await prisma.facility.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return serialize(facilities)
}

import { prisma } from "@/lib/db"

export async function healthSystemFacilityIds(facility: {
  id: string
  healthSystemId: string | null
}): Promise<Set<string>> {
  const ids = new Set<string>([facility.id])
  if (!facility.healthSystemId) return ids
  const rows = await prisma.facility.findMany({
    where: { healthSystemId: facility.healthSystemId },
    select: { id: true },
  })
  for (const r of rows) ids.add(r.id)
  return ids
}

export async function assertFacilitiesInHealthSystem(
  facility: { id: string; healthSystemId: string | null },
  requested: readonly string[],
): Promise<void> {
  if (requested.length === 0) return
  const allowed = await healthSystemFacilityIds(facility)
  const outside = requested.filter((id) => !allowed.has(id))
  if (outside.length > 0) {
    throw new Error("A contract can only be shared with facilities in your health system")
  }
}

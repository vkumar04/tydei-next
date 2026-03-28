"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export async function getVendors() {
  await requireFacility()

  return prisma.vendor.findMany({
    where: { status: "active" },
    select: { id: true, name: true, displayName: true },
    orderBy: { name: "asc" },
  })
}

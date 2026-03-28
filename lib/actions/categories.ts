"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export async function getCategories() {
  await requireFacility()

  return prisma.productCategory.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}

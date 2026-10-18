"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { callerVendorDivisionIds } from "@/lib/divisions/caller-divisions"

/** The caller's pickable divisions (e.g. the proposal builder's division
 *  selector). Restricted callers get THEIR divisions; enterprise/Super get
 *  the vendor's full list (picking is optional for them). */
export interface MyVendorDivisionScope {
  restricted: boolean
  divisions: { id: string; name: string }[]
}

export async function getMyVendorDivisions(): Promise<MyVendorDivisionScope> {
  const { vendor, user } = await requireVendor()
  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisions = await prisma.vendorDivision.findMany({
    where:
      divisionIds === undefined
        ? { vendorId: vendor.id }
        : { id: { in: divisionIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  return { restricted: divisionIds !== undefined, divisions }
}

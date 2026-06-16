"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import type { VendorReportsContract } from "@/components/vendor/reports/hub/vendor-reports-types"

// ─── Vendor Report Contracts List (for the hub selector) ─────────
//
// Vendor-scoped mirror of `getContracts` in `lib/actions/reports.ts`.
// Returns the selector rows the Vendor Reports Hub control bar uses to
// populate its Contract dropdown.
//
// Differences from the facility original:
//   1. Gated with `requireVendor()` — scope is the session vendor.
//   2. Scoped via `contractsOwnedByVendor(vendor.id)` — covers both the
//      primary `vendorId` AND grouped `additionalVendorIds` membership
//      (group-vendor-drift class). NEVER hand-roll the OR.
//   3. Each row carries the related facility's name + id (a vendor's
//      contracts span many facilities, so the selector shows which
//      facility a contract belongs to — where the facility hub instead
//      shows the vendor).

export async function getVendorReportContracts(): Promise<
  VendorReportsContract[]
> {
  const { vendor } = await requireVendor()

  const contracts = await prisma.contract.findMany({
    where: {
      ...contractsOwnedByVendor(vendor.id),
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      facility: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  return serialize(
    contracts.map((c) => ({
      id: c.id,
      name: c.name,
      contractType: c.contractType,
      status: c.status,
      vendorId: c.vendor.id,
      vendorName: c.vendor.name,
      facilityId: c.facility?.id ?? null,
      facilityName: c.facility?.name ?? "—",
    })),
  )
}

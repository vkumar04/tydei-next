import Link from "next/link"
import { requireFacility } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { NewBundleForm } from "./new-bundle-form"

export default async function NewBundlePage() {
  const { facility } = await requireFacility()

  // Pull the facility's active contracts for the member picker. Kept
  // lean — id, name, vendor name — to avoid hydration bloat.
  const contracts = await prisma.contract.findMany({
    where: {
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
      status: { in: ["active", "expiring"] },
    },
    select: {
      id: true,
      name: true,
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  const vendors = await prisma.vendor.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New Tie-In Bundle</h1>
          <p className="text-sm text-muted-foreground">
            Bundle multiple contracts together under one compliance /
            rebate structure.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/contracts/bundles">← Cancel</Link>
        </Button>
      </div>
      <NewBundleForm contracts={contracts} vendors={vendors} />
    </div>
  )
}

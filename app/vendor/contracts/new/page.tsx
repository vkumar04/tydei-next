import { requireVendor } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { vendorRelatedFacilityWhere } from "@/lib/vendors/related-facilities"
import { VendorContractSubmission } from "@/components/vendor/contracts/vendor-contract-submission"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default async function NewVendorContractPage() {
  const { vendor } = await requireVendor()

  // Charles 2026-07-27: this used to list EVERY active facility on the
  // platform. Harmless while a vendor submission always needed facility
  // approval; a cross-tenant hazard now that a one-way submission can
  // auto-activate into a LIVE contract (lib/connections/operating-mode.ts).
  // Same relationship predicate the prospective + reports pickers use, so a
  // vendor can only aim a contract at a facility it actually deals with.
  // A vendor with no relationships yet gets an empty list — the form then
  // falls back to a facility-less standalone submission rather than offering
  // strangers' facilities.
  const facilities = await prisma.facility.findMany({
    where: { status: "active", ...vendorRelatedFacilityWhere(vendor.id) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return (
    <div className="space-y-6">
      {/* Header with back arrow matching v0 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/vendor/contracts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Submit New Contract</h1>
          <p className="text-muted-foreground">
            Submit a contract for facility review and approval
          </p>
        </div>
      </div>
      <VendorContractSubmission
        vendorId={vendor.id}
        vendorName={vendor.name}
        facilities={facilities}
      />
    </div>
  )
}

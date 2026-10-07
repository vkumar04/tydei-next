import { requireVendor } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorPendingContractsList } from "@/components/vendor/contracts/vendor-pending-contracts-list"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, Plus } from "lucide-react"

export default async function VendorPendingContractsPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Submissions"
        description="Track the approval status of contracts you've submitted to facilities"
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/vendor/contracts">
                <ArrowLeft className="size-4" /> My Contracts
              </Link>
            </Button>
            <Button asChild>
              <Link href="/vendor/contracts/new">
                <Plus className="size-4" /> New Contract
              </Link>
            </Button>
          </div>
        }
      />
      <VendorPendingContractsList vendorId={vendor.id} />
    </div>
  )
}

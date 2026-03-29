import { requireVendor } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorContractList } from "@/components/vendor/contracts/vendor-contract-list"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus } from "lucide-react"

export default async function VendorContractsPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="View and manage your facility contracts"
        action={
          <Button asChild>
            <Link href="/vendor/contracts/new">
              <Plus className="size-4" /> Submit Contract
            </Link>
          </Button>
        }
      />
      <VendorContractList vendorId={vendor.id} />
    </div>
  )
}

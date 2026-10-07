import { requireVendor } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorContractList } from "@/components/vendor/contracts/vendor-contract-list"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus, ClipboardList } from "lucide-react"

export default async function VendorContractsPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Contracts"
        description="Manage your contracts and submissions with facilities"
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/vendor/contracts/pending">
                <ClipboardList className="size-4" /> Pending Submissions
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
      <VendorContractList vendorId={vendor.id} />
    </div>
  )
}

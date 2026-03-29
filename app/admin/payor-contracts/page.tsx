import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { PayorContractTable } from "@/components/admin/payor-contract-table"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default async function AdminPayorContractsPage() {
  await requireAdmin()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          title="Payor Contracts"
          description="Manage payor contract rates for accurate case costing reimbursement"
        />
      </div>
      <PayorContractTable />
    </div>
  )
}

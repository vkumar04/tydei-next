import { requireAdmin } from "@/lib/actions/auth"
import { PayorContractTable } from "@/components/admin/payor-contract-table"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default async function AdminPayorContractsPage() {
  await requireAdmin()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Payor Contracts
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage payor contract rates for accurate case costing reimbursement
            </p>
          </div>
        </div>
      </div>
      <PayorContractTable />
    </div>
  )
}

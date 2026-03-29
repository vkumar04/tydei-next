import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { PayorContractTable } from "@/components/admin/payor-contract-table"

export default async function AdminPayorContractsPage() {
  await requireAdmin()

  return (
    <div className="space-y-6">
      <PageHeader title="Payor Contracts" description="Manage insurance/payor contracts and CPT rates" />
      <PayorContractTable />
    </div>
  )
}

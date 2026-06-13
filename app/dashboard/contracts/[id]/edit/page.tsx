import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { EditContractClient } from "@/components/contracts/edit-contract-client"
import { requireFacility } from "@/lib/actions/auth"

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireFacility()
  const { id } = await params
  const [vendors, categories] = await Promise.all([
    getVendors(),
    getCategories(),
  ])

  return (
    <EditContractClient
      contractId={id}
      vendors={vendors}
      categories={categories}
    />
  )
}

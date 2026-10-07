import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { EditContractClient } from "@/components/contracts/edit-contract-client"
import { requireFacility } from "@/lib/actions/auth"
import { mappedCategoryUniverse } from "@/lib/contracts/mapped-category-universe"

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { facility } = await requireFacility()
  const { id } = await params
  const [vendors, categories, mappedCategories] = await Promise.all([
    getVendors(),
    getCategories(),
    // bugs.rtfd 2026-06-13: term picker offers the mapped-category universe
    // (confirmed CategoryMapping targets ∪ price-file categories), unioned
    // with this contract's persisted ContractPricing categories.
    mappedCategoryUniverse(facility.id),
  ])

  return (
    <EditContractClient
      contractId={id}
      vendors={vendors}
      categories={categories}
      mappedCategories={mappedCategories}
    />
  )
}

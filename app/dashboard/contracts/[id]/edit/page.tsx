import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { EditContractClient } from "@/components/contracts/edit-contract-client"
import { requireFacility } from "@/lib/actions/auth"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { facility } = await requireFacility()
  const { id } = await params
  // bugs.rtfd 2026-06-13 ("not all categories are on the category list"):
  // the term category picker was restricted to the contract's selected
  // categories. Pass the facility's real COG categories so any category
  // with actual spend is scopeable (and import-junk taxonomy rows stay
  // out of the dropdown).
  const [vendors, categories, cogCategories] = await Promise.all([
    getVendors(),
    getCategories(),
    facilityCogCategoryUniverse(facility.id),
  ])

  return (
    <EditContractClient
      contractId={id}
      vendors={vendors}
      categories={categories}
      cogCategories={cogCategories}
    />
  )
}

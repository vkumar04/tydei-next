import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { EditContractClient } from "@/components/contracts/edit-contract-client"
import { requireFacility } from "@/lib/actions/auth"
import { facilityChosenCategoryNames } from "@/lib/contracts/facility-category-universe"

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { facility } = await requireFacility()
  const { id } = await params
  // bugs.rtfd 2026-06-13 ("not all categories are on the category list" /
  // "whatever was on the mapping list and chosen"): the term category
  // picker was restricted to the contract's selected categories. Pass the
  // facility's CHOSEN category universe (confirmed category-mapping targets
  // + COG spend) so every category the user mapped/consolidated into is
  // scopeable (incl. ones like "Spine" whose spend arrives under a mapped
  // source name), while import-junk taxonomy rows stay out of the dropdown.
  const [vendors, categories, cogCategories] = await Promise.all([
    getVendors(),
    getCategories(),
    facilityChosenCategoryNames(facility.id),
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

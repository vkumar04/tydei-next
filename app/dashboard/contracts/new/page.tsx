import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { NewContractClient } from "@/components/contracts/new-contract-client"
import { requireFacility } from "@/lib/actions/auth"
import { facilityChosenCategoryNames } from "@/lib/contracts/facility-category-universe"

export default async function NewContractPage() {
  // Charles 2026-04-25 (audit follow-up — auth-gate scanner): every
  // /dashboard/* page must explicitly gate on `requireFacility()`
  // so a vendor user can't reach this surface even if the page's
  // data loaders happen to leave a hole.
  const { facility } = await requireFacility()
  const [vendors, categories, cogCategories] = await Promise.all([
    getVendors(),
    getCategories(),
    // bugs.rtfd 2026-06-13: chosen category universe (confirmed
    // mapping targets + COG spend) for the term picker.
    facilityChosenCategoryNames(facility.id),
  ])

  return (
    <NewContractClient
      vendors={vendors}
      categories={categories}
      cogCategories={cogCategories}
    />
  )
}

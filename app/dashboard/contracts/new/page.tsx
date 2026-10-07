import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { NewContractClient } from "@/components/contracts/new-contract-client"
import { requireFacility } from "@/lib/actions/auth"
import { mappedCategoryUniverse } from "@/lib/contracts/mapped-category-universe"

export default async function NewContractPage() {
  // Charles 2026-04-25 (audit follow-up — auth-gate scanner): every
  // /dashboard/* page must explicitly gate on `requireFacility()`
  // so a vendor user can't reach this surface even if the page's
  // data loaders happen to leave a hole.
  const { facility } = await requireFacility()
  const [vendors, categories, mappedCategories] = await Promise.all([
    getVendors(),
    getCategories(),
    // bugs.rtfd 2026-06-13: term picker offers the mapped-category universe
    // (confirmed CategoryMapping targets ∪ price-file categories), unioned
    // client-side with the in-memory price file being uploaded.
    mappedCategoryUniverse(facility.id),
  ])

  return (
    <NewContractClient
      vendors={vendors}
      categories={categories}
      mappedCategories={mappedCategories}
    />
  )
}

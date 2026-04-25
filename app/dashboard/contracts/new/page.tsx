import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { NewContractClient } from "@/components/contracts/new-contract-client"
import { requireFacility } from "@/lib/actions/auth"

export default async function NewContractPage() {
  // Charles 2026-04-25 (audit follow-up — auth-gate scanner): every
  // /dashboard/* page must explicitly gate on `requireFacility()`
  // so a vendor user can't reach this surface even if the page's
  // data loaders happen to leave a hole.
  await requireFacility()
  const [vendors, categories] = await Promise.all([
    getVendors(),
    getCategories(),
  ])

  return <NewContractClient vendors={vendors} categories={categories} />
}

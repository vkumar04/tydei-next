import { getVendors } from "@/lib/actions/vendors"
import { getCategories } from "@/lib/actions/categories"
import { NewContractClient } from "@/components/contracts/new-contract-client"

export default async function NewContractPage() {
  const [vendors, categories] = await Promise.all([
    getVendors(),
    getCategories(),
  ])

  return <NewContractClient vendors={vendors} categories={categories} />
}

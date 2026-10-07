import { requireFacility } from "@/lib/actions/auth"
import { getCategoryUsage } from "@/lib/actions/categories/usage"
import { CategoryMergeClient } from "@/components/facility/categories/category-merge-client"
import { PageHeader } from "@/components/shared/page-header"

export default async function CategoriesSettingsPage() {
  await requireFacility()
  const usage = await getCategoryUsage()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Category Aliases"
        description="Merge near-duplicate category labels (e.g. 'Total joint' and 'joints total') so market share and rebate aggregations don't fragment."
      />
      <CategoryMergeClient initialUsage={usage} />
    </div>
  )
}

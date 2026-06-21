"use client"

/**
 * Bug 1/10 follow-up (Vick 2026-06-02): "needs mapping" nudge. When a
 * contract's vendors have category names that resolve to no canonical
 * ProductCategory and have no confirmed mapping, that spend won't
 * attribute on-contract — and today that's silent. Surface it with a
 * one-click path to the Pricing tab's "Map Categories" dialog.
 */
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle } from "lucide-react"
import { getContractCategoryHealth } from "@/lib/actions/cog-category-mapping"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency } from "@/lib/formatting"

export function ContractCategoryHealthBanner({
  contractId,
}: {
  contractId: string
}) {
  const { data } = useQuery({
    queryKey: queryKeys.contracts.categoryHealth(contractId),
    queryFn: () => getContractCategoryHealth(contractId),
  })

  if (!data || data.unmappedCount === 0) return null

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="space-y-0.5">
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {data.unmappedCount} category name
          {data.unmappedCount === 1 ? "" : "s"} on this contract&rsquo;s
          vendors aren&rsquo;t mapped to a product category
          {data.unmappedSpend > 0 && (
            <> — {formatCurrency(data.unmappedSpend)} of spend may not attribute</>
          )}
          .
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          e.g. {data.unmappedExamples.join(", ")}. Open the{" "}
          <span className="font-medium">Pricing</span> tab →{" "}
          <span className="font-medium">Map Categories</span> to align them
          (one click each; the rule then auto-applies to future imports).
        </p>
      </div>
    </div>
  )
}

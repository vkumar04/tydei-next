"use client"

import { useQuery } from "@tanstack/react-query"
import { getCategorySuggestions as getCategorySuggestionsAction } from "@/lib/actions/contracts/category-suggestions"

/**
 * Charles 2026-04-25: surface other contracts at the facility that
 * already use the same category, so users entering a new contract
 * for a different vendor can see how their peers configured the
 * same scope. Shows a compact one-line hint per matched contract;
 * clicking opens the contract in a new tab so the user can compare
 * tier ladders side-by-side.
 */
export function CategoryMappingSuggestions({
  scopedCategoryIds,
  resolvedCategories,
}: {
  scopedCategoryIds: string[]
  resolvedCategories: Array<{ id: string; name: string }>
}) {
  // Use the FIRST scoped category as the lookup key; in the common
  // case users add categories one at a time and only the first
  // matters for "what does my peer's contract look like".
  const firstCatId = scopedCategoryIds[0]
  const categoryName =
    resolvedCategories.find((c) => c.id === firstCatId)?.name ?? null
  const { data } = useQuery({
    queryKey: ["category-suggestions", categoryName],
    queryFn: () =>
      categoryName
        ? getCategorySuggestionsAction({ category: categoryName })
        : Promise.resolve([]),
    enabled: Boolean(categoryName),
  })
  if (!categoryName || !data || data.length === 0) return null
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-2.5 text-xs">
      <p className="font-medium text-foreground">
        Other contracts using {categoryName}:
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {data.slice(0, 5).map((s) => (
          <li
            key={s.contractId}
            className="flex items-baseline justify-between gap-3"
          >
            <a
              href={`/dashboard/contracts/${s.contractId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-primary hover:underline"
            >
              {s.vendorName} — {s.contractName}
            </a>
            {s.templateTerm && (
              <span className="shrink-0 text-muted-foreground">
                {s.templateTerm.tiers.length} tier
                {s.templateTerm.tiers.length === 1 ? "" : "s"} ·{" "}
                {s.templateTerm.evaluationPeriod}-eval
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Open in a new tab to compare configurations side-by-side.
      </p>
    </div>
  )
}

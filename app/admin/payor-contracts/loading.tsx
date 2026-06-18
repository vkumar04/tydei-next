import { Skeleton } from "@/components/ui/skeleton"

/**
 * Admin payor-contracts loading skeleton — mirrors
 * `app/admin/payor-contracts/page.tsx` + `components/admin/payor-contract-table.tsx`:
 * page header (back button + title + subtitle), an "Add Contract" button row
 * (justify-end), the 4-card KPI grid (md:grid-cols-4, label + value), and the
 * contract-list card (title + search + table). 2026-06-18: was missing the
 * button row and 4-card grid.
 */
export default function AdminPayorContractsLoading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="size-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
      </div>

      {/* Add Contract button row */}
      <div className="flex items-center justify-end">
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* KPI grid */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Contract list card */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-4 p-6">
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-64 rounded-md" />
        </div>
        <div className="space-y-3 px-6 pb-6">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

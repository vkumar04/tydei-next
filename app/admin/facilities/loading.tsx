import { Skeleton } from "@/components/ui/skeleton"

/**
 * Admin facilities loading skeleton — mirrors `app/admin/facilities/page.tsx` +
 * `components/admin/facility-table.tsx`: page header (back button + title +
 * subtitle), the 4-card stats grid (md:grid-cols-4, icon box + value + label),
 * then a DataTable (search bar + rows). 2026-06-18: was missing the 4-card
 * stats grid.
 */
export default function AdminFacilitiesLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="size-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* DataTable */}
      <div className="rounded-xl border bg-card p-4">
        <Skeleton className="mb-4 h-9 w-64" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

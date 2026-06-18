import { Skeleton } from "@/components/ui/skeleton"

/**
 * Prospective-analysis loading skeleton — mirrors the real layout in
 * `components/facility/analysis/prospective/prospective-client.tsx` →
 * `prospective-tabs.tsx`: the `p-6 space-y-6` shell, the "Evaluate Vendor
 * Proposals" header (title + subtitle), the 5-tab strip (Upload / Manual /
 * Proposals / Pricing / Compare), and the default Upload tab's two-up
 * dropzone card. 2026-06-18: was a static 3-KPI + chart + table analysis
 * layout that didn't match the screen.
 */
export default function ProspectiveLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="space-y-1.5">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>

      {/* Tab strip (Upload / Manual / Proposals / Pricing / Compare) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* Default Upload tab: 2/3 inputs card + 1/3 spend-pattern card */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            {/* Card header */}
            <div className="space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>

            {/* Vendor selector */}
            <div className="mt-5 space-y-1.5">
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-9 w-full max-w-sm rounded-md" />
            </div>

            {/* Two-up dropzones: contract PDF + price file */}
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center"
                >
                  <Skeleton className="size-8 rounded" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
              ))}
            </div>

            {/* Advanced disclosure row */}
            <Skeleton className="mt-4 h-10 w-full rounded-md" />
          </div>
        </div>

        {/* Spend-pattern side card */}
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { Skeleton } from "@/components/ui/skeleton"

/**
 * `/dashboard/analysis` immediately redirects to
 * `/dashboard/analysis/prospective` (see page.tsx), so this skeleton only
 * flashes briefly during the redirect. It mirrors the prospective skeleton
 * (same `p-6 space-y-6` shell + header + 5-tab strip + upload dropzone) so
 * the transition is seamless. 2026-06-18.
 */
export default function AnalysisLoading() {
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
            <div className="space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <div className="mt-5 space-y-1.5">
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-9 w-full max-w-sm rounded-md" />
            </div>
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
            <Skeleton className="mt-4 h-10 w-full rounded-md" />
          </div>
        </div>

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

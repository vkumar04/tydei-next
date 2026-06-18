import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Rebate Optimizer loading skeleton — mirrors the real layout in
 * `components/facility/rebate-optimizer/optimizer-client.tsx`: the page
 * header (h1 + description), the control bar (vendor filter + contract
 * count), the hero panel (3 KPIs: Earned YTD / Potential Additional /
 * Close to Next Tier + best-opportunity callout), the AI Smart
 * Recommendations panel, the 5-tab strip (Contracts / Earnings /
 * Scenarios / Opportunities / Sensitivity), and the tab content
 * (2/3 chart + 1/3 side card). 2026-06-18: was 3 generic cards.
 */
export default function RebateOptimizerLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      {/* Control bar (vendor filter + contract count) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="ml-auto h-4 w-32" />
      </div>

      {/* Hero panel (3 KPIs + best-opportunity callout) */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-80" />
          </div>
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-3 w-36" />
            </div>
          ))}
        </div>
      </section>

      {/* AI Smart Recommendations panel */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Tab strip (5 tabs) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      {/* Tab content: 2/3 chart + 1/3 side card */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-48" />
          <Skeleton className="h-[300px] w-full rounded" />
        </Card>
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-36" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

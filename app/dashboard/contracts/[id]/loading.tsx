import { Skeleton } from "@/components/ui/skeleton"

/**
 * Contract-detail loading skeleton — mirrors the loaded layout in
 * `components/contracts/contract-detail-client.tsx`: the `space-y-6` shell,
 * a header row (back chevron + contract name + vendor subtitle on the left,
 * action buttons on the right), an optional period-selector row, the 4-up
 * stat cards (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`), the 6-tab strip
 * (Overview / Transactions / Performance / Rebates & Tiers / Pricing /
 * Documents), and the Overview chart card. 2026-06-18: was a 2/3 + 1/3
 * key-value split that didn't match the screen.
 */
export default function ContractDetailLoading() {
  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Skeleton className="mt-0.5 size-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      </div>

      {/* ── Period selector ───────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-9 w-[280px] rounded-md" />
      </div>

      {/* ── Stat cards ────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tab strip ─────────────────────────────────────────── */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* ── Overview content: wide chart card ─────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="h-[360px] w-full rounded" />
      </div>
    </div>
  )
}

"use client"

import { AlertTriangle, FileText } from "lucide-react"
import { HeroStat } from "@/components/shared/stats/hero-stat"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the contracts-list page. Collapses what were previously
 * six stacked KPI cards into one elevated, scannable unit:
 *
 *   1. Eyebrow + headline sentence (how many contracts, what scope)
 *   2. Warning pill (expiring-soon count) when non-zero
 *   3. Four hero stats separated by `border-y py-6`:
 *        Total contracts, Active, Total value, Rebates YTD
 *      Avg Score is demoted into the Active sublabel because it's only
 *      meaningful in the context of the active book.
 *
 * No bottom narrative grid — this is a list page, not an analysis page.
 *
 * SCOPE INVARIANT (2026-07-28). Every number here — the headline count, the
 * expiring pill, and all four stats — must arrive from ONE call to
 * `getContractStats`, computed server-side over the whole facility scope.
 * `activeCount` and `expiringSoon` used to be counted in the client from
 * the table's current page (20 rows), so a 45-contract facility rendered
 * "45 Total" next to an "Active" that could never exceed 20 and an
 * "expiring soon" that depended on recent edit activity. Never wire a prop
 * on this component to the loaded rows — a page is not the portfolio.
 */
export interface ContractsHeroProps {
  totalContracts: number
  activeCount: number
  totalValue: number
  rebatesYTD: number
  expiringSoon: number
  /**
   * Days behind `expiringSoon`, echoed by the server that counted it so the
   * pill's wording can't drift from the filter that produced the number.
   */
  expiringSoonWindowDays?: number
  scopeLabel: string
  isLoading?: boolean
}

export function ContractsHero({
  totalContracts,
  activeCount,
  totalValue,
  rebatesYTD,
  expiringSoon,
  expiringSoonWindowDays = 30,
  scopeLabel,
  isLoading,
}: ContractsHeroProps) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Contracts portfolio
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {isLoading ? (
              <Skeleton className="h-7 w-72" />
            ) : (
              <>
                {totalContracts}{" "}
                {totalContracts === 1 ? "contract" : "contracts"}
                {" · "}
                <span className="text-muted-foreground">{scopeLabel}</span>
              </>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && expiringSoon > 0 && (
            <Badge
              variant="secondary"
              className="gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {expiringSoon} expiring in {expiringSoonWindowDays} days
            </Badge>
          )}
          {/* Tie-In Bundles top-level CTA removed per Charles's feedback —
              the bundle abstraction was confusing users into thinking
              tie-ins required this separate setup. Tie-in capital now
              lives directly on Contract (contractType = tie_in) and is
              set during contract creation; bundles remain accessible
              from contract-detail pages that need them. */}
        </div>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Contracts"
          value={isLoading ? null : String(totalContracts)}
          sublabel="Across current scope"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
        <HeroStat
          label="Active"
          value={isLoading ? null : String(activeCount)}
          sublabel="Across current scope"
          tone="positive"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
        <HeroStat
          label="Total Value"
          value={isLoading ? null : formatCurrency(totalValue)}
          sublabel="Lifetime commitment"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
        <HeroStat
          label="Rebates Earned (YTD)"
          value={isLoading ? null : formatCurrency(rebatesYTD)}
          sublabel="Closed periods only"
          tone="positive"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
      </div>
    </section>
  )
}

"use client"

/**
 * Vendor renewals page — hero + tabs layout (2026-04-22 redesign,
 * mirrors the facility Renewals page). The hero reports 30d/60d/90d/
 * At-Risk, the ControlBar carries the Facility + Status select + search,
 * and the Tabs partition the pipeline into Upcoming / In Progress /
 * Healthy / Expired stages.
 */

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { FileText } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { useExpiringContracts } from "@/hooks/use-renewals"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import { useVendorPendingContracts } from "@/hooks/use-pending-contracts"
import type { ExpiringContract } from "@/lib/actions/renewals"
import { PageHeader } from "@/components/shared/page-header"
import { VendorRenewalPipeline } from "./vendor-renewal-pipeline"
import {
  VendorRenewalsHero,
  type VendorRenewalsHeroStats,
} from "./vendor-renewals-hero"
import {
  VendorRenewalsControlBar,
  type VendorRenewalStage,
} from "./vendor-renewals-control-bar"

interface VendorRenewalsClientProps {
  vendorId: string
}

const CRITICAL_UNSTARTED_DAYS = 14

const STAGE_TABS: { value: VendorRenewalStage; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "in_progress", label: "In Progress" },
  // 2026-06-09 audit L20: ">180 days out" is NOT "Renewed" — no renewal
  // event ever happened. The stage value stays "renewed" (persisted
  // nowhere, but keeps the diff minimal); only the user-facing label
  // tells the truth.
  { value: "renewed", label: "Healthy" },
  { value: "expired", label: "Expired" },
]

function exportRenewalsCalendar() {
  try {
    window.location.href = "/api/renewals/export"
    toast.success("Calendar exported", {
      description: "Downloading .ics — import into your calendar app",
    })
  } catch {
    toast.error("Export failed", {
      description: "Could not generate calendar file",
    })
  }
}

/**
 * Map an ExpiringContract to its pipeline stage.
 *
 * Vendor-side pipeline has no explicit "renewal workflow" state beyond
 * submitRenewalProposal side-effects, so stage is derived from
 * `daysUntilExpiry` + the backing contract status (audit L20: d < 0 is
 * overdue/expired; day 0–30 belongs to the 30-day bucket — aligned with
 * the facility side):
 *
 * - expired:    daysUntilExpiry < 0 OR status === "expired"
 * - in_progress: 0 <= daysUntilExpiry <= 90 (active negotiation window)
 * - upcoming:   90 < daysUntilExpiry <= 180
 * - renewed:    daysUntilExpiry > 180 (far from expiration = healthy;
 *               labeled "Healthy" in the UI)
 */
function getStage(c: ExpiringContract): Exclude<VendorRenewalStage, "all"> {
  if (c.daysUntilExpiry < 0 || c.status === "expired") return "expired"
  if (c.daysUntilExpiry <= 90) return "in_progress"
  if (c.daysUntilExpiry <= 180) return "upcoming"
  return "renewed"
}

export function VendorRenewalsClient({ vendorId }: VendorRenewalsClientProps) {
  const { data, isLoading } = useExpiringContracts(vendorId, 365, "vendor")
  // The portfolio total, NOT the size of the 365-day window. `contracts` is the
  // expiring-window query; using its length as "totalContracts" made the hero
  // announce "All 1 contracts are more than 90 days from expiration" to a vendor
  // holding 5. `portfolio.contractCount` is a server-side `_count.id` over the
  // whole portfolio — the same aggregate /vendor/contracts already renders.
  // Charles 2026-07-28 sweep.
  // `pageSize: 1` on purpose: only `portfolio.contractCount` is read here, and
  // `portfolioAgg` (vendor-contracts.ts:111,173) is a separate aggregate from
  // the page query — so shrinking the page costs nothing and avoids pulling 20
  // contract rows this component discards. It is a distinct query key from the
  // contracts page's (keys include the filter object), so it would otherwise be
  // a second full fetch rather than a cache hit.
  const { data: portfolioData } = useVendorContracts(vendorId, { pageSize: 1 })
  // Same population /vendor/contracts counts: the server portfolio rollup PLUS
  // in-flight submissions (vendor-contract-list.tsx:236-253). Counting only the
  // rollup here meant the two surfaces disagreed whenever a submission was in
  // flight — "5 contracts" on one page, "All 4 contracts…" on the other, which
  // is the same two-numbers-that-contradict defect this whole sweep has been
  // closing. Derived identically so they cannot drift apart again.
  const { data: pendingData } = useVendorPendingContracts(vendorId)
  const inFlightPendingCount = useMemo(
    () =>
      (pendingData ?? []).filter(
        // The SAME three statuses vendor-contract-list.tsx:236-243 counts
        // (there it reads `pendingStatus`, which is just `status` renamed at
        // :99). Rejected and withdrawn stay browsable but are not portfolio.
        (pc) =>
          pc.status === "draft" ||
          pc.status === "submitted" ||
          pc.status === "revision_requested",
      ).length,
    [pendingData],
  )
  const contracts: ExpiringContract[] = useMemo(() => data ?? [], [data])

  const [stage, setStage] = useState<VendorRenewalStage>("upcoming")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  const [search, setSearch] = useState("")

  const facilities = useMemo(
    () =>
      [
        ...new Set(
          contracts.map((c) => c.facilityName).filter((n): n is string => !!n),
        ),
      ].sort(),
    [contracts],
  )

  const contractStages = useMemo(
    () => contracts.map((c) => ({ c, stage: getStage(c) })),
    [contracts],
  )

  const counts = useMemo(() => {
    const base = {
      all: contracts.length,
      upcoming: 0,
      in_progress: 0,
      renewed: 0,
      expired: 0,
    }
    for (const { stage: s } of contractStages) base[s] += 1
    return base
  }, [contracts, contractStages])

  const heroStats = useMemo<VendorRenewalsHeroStats>(() => {
    let e30 = 0
    let e60 = 0
    let e90 = 0
    let atRisk = 0
    let criticalUnstarted = 0
    // Audit L20: d < 0 = overdue/expired (excluded — it lives in the
    // Expired stage), 0–30 = the 30-day bucket. Aligned with the
    // facility hero's bucket definitions.
    for (const c of contracts) {
      const d = c.daysUntilExpiry
      if (d >= 0 && d <= 30) {
        e30 += 1
        if (d <= CRITICAL_UNSTARTED_DAYS) criticalUnstarted += 1
      } else if (d > 30 && d <= 60) {
        e60 += 1
      } else if (d > 60 && d <= 90) {
        e90 += 1
      }
      if (d >= 0 && d <= 90) atRisk += 1
    }
    return {
      expiring30: e30,
      expiring60: e60,
      expiring90: e90,
      atRisk,
      // Portfolio-wide. The expiring buckets above stay window-scoped, which is
      // correct — they describe the window. Only this one names the portfolio.
      // NULL while the portfolio aggregate is still in flight — NOT
      // `contracts.length`.
      //
      // The `?? contracts.length` fallback that used to sit here silently
      // re-introduced the very bug the comment at the top of this component
      // describes: during the portfolio query's loading window the hero
      // announced "All 1 contracts are more than 90 days from expiration" to a
      // vendor holding 5, because `contracts` is the 365-day EXPIRING window,
      // not the portfolio. It resolved to the right number a moment later, so
      // it looked like a flake — the full Playwright suite caught it on
      // 2026-07-29 while the single test passed in isolation every time.
      //
      // A number that is wrong-but-confident for 200ms is still wrong; the
      // fallback made a portfolio claim out of window data. The hero renders a
      // neutral headline until the real count arrives.
      totalContracts:
        portfolioData?.portfolio?.contractCount === undefined
          ? null
          : portfolioData.portfolio.contractCount + inFlightPendingCount,
      criticalUnstarted,
    }
  }, [contracts, portfolioData?.portfolio?.contractCount, inFlightPendingCount])

  const filteredByChrome = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return contractStages.filter(({ c }) => {
      if (facilityFilter !== "all" && c.facilityName !== facilityFilter)
        return false
      if (!needle) return true
      return (
        c.name.toLowerCase().includes(needle) ||
        (c.facilityName?.toLowerCase().includes(needle) ?? false) ||
        (c.contractNumber?.toLowerCase().includes(needle) ?? false)
      )
    })
  }, [contractStages, facilityFilter, search])

  const contractsForStage = (s: VendorRenewalStage): ExpiringContract[] => {
    if (s === "all") return filteredByChrome.map((x) => x.c)
    return filteredByChrome.filter((x) => x.stage === s).map((x) => x.c)
  }

  // Empty state — no data at all
  if (!isLoading && contracts.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Contract Renewals"
          description="Track and manage upcoming contract renewals across all facilities"
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Expiring Contracts</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              No contracts are expiring within the next year. Check back later
              or extend the window.
            </p>
            <Button asChild>
              <Link href="/vendor/contracts">View All Contracts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contract Renewals</h1>
        <p className="text-sm text-muted-foreground">
          Track and manage upcoming contract renewals across all facilities.
        </p>
      </div>

      <VendorRenewalsControlBar
        stage={stage}
        onStageChange={setStage}
        facilities={facilities}
        facilityFilter={facilityFilter}
        onFacilityFilterChange={setFacilityFilter}
        search={search}
        onSearchChange={setSearch}
        onExportCalendar={exportRenewalsCalendar}
        counts={counts}
      />

      {isLoading ? (
        <Skeleton className="h-[260px] rounded-xl" />
      ) : (
        <VendorRenewalsHero stats={heroStats} />
      )}

      {isLoading ? (
        <Skeleton className="h-[400px] rounded-xl" />
      ) : (
        <Tabs
          value={stage === "all" ? "upcoming" : stage}
          onValueChange={(v) => setStage(v as VendorRenewalStage)}
          className="w-full"
        >
          <TabsList>
            {STAGE_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label} ({counts[t.value]})
              </TabsTrigger>
            ))}
          </TabsList>
          {STAGE_TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-4">
              <VendorRenewalPipeline
                contracts={contractsForStage(t.value)}
                emptyMessage={`No contracts in the ${t.label.toLowerCase()} stage`}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

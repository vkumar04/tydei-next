"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MarketShareCharts } from "./market-share-charts"
import { MarketShareHero } from "./market-share-hero"
import { getVendorMarketShare } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"
import { levenshteinSimilarity } from "@/lib/utils/levenshtein"

import { CategoryTableSection } from "./sections/category-table-section"
import { CategoryBreakdownSection } from "./sections/category-breakdown-section"
import { GrowthOpportunitiesSection } from "./sections/growth-opportunities-section"
import { SimilarCategoriesAlert } from "./sections/similar-categories-alert"
import { FacilityTableSection } from "./sections/facility-table-section"
import { CompetitorsSection } from "./sections/competitors-section"
import type {
  CategoryRow,
  FacilityRow,
  SimilarPair,
  MarketShareStats,
} from "./sections/types"

interface MarketShareClientProps {
  vendorId: string
}

export function MarketShareClient({ vendorId }: MarketShareClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")
  const [mergedCategories, setMergedCategories] = useState<Map<string, string>>(
    new Map(),
  )

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.marketShare(vendorId, { timeRange }),
    queryFn: () => getVendorMarketShare({ vendorId }),
  })

  // ─── Derive view models ─────────────────────────────────────
  // Sections are pure views; this client owns all data shaping.

  const stats = useMemo<MarketShareStats | null>(() => {
    if (!data) return null
    const totalCategories = data.byCategory.length
    const totalVendorSpend = data.byCategory.reduce((s, c) => s + c.vendorShare, 0)
    const totalMarketSpend = data.byCategory.reduce((s, c) => s + c.totalMarket, 0)
    const overallSharePct =
      totalMarketSpend > 0
        ? Math.round((totalVendorSpend / totalMarketSpend) * 1000) / 10
        : 0
    const activeContracts = data.byFacility.length
    const revenueRank = data.byCategory.length > 0 ? 1 : 0
    return {
      totalCategories,
      overallSharePct,
      activeContracts,
      revenueRank,
      totalVendorSpend,
      totalMarketSpend,
    }
  }, [data])

  const categoryRows = useMemo<CategoryRow[]>(() => {
    if (!data) return []
    // Consolidate merged categories into their target bucket.
    const consolidated = new Map<string, { vendorShare: number; totalMarket: number }>()
    for (const c of data.byCategory) {
      const target = mergedCategories.get(c.category) ?? c.category
      const existing = consolidated.get(target) ?? { vendorShare: 0, totalMarket: 0 }
      consolidated.set(target, {
        vendorShare: existing.vendorShare + c.vendorShare,
        totalMarket: existing.totalMarket + c.totalMarket,
      })
    }
    return Array.from(consolidated.entries())
      .map(([category, vals]) => {
        const sharePct =
          vals.totalMarket > 0
            ? Math.round((vals.vendorShare / vals.totalMarket) * 1000) / 10
            : 0
        const trend: "up" | "down" | "flat" =
          sharePct > 40 ? "up" : sharePct < 15 ? "down" : "flat"
        return {
          category,
          yourSpend: vals.vendorShare,
          totalMarket: vals.totalMarket,
          sharePct,
          trend,
        }
      })
      .sort((a, b) => b.sharePct - a.sharePct)
  }, [data, mergedCategories])

  const similarPairs = useMemo<SimilarPair[]>(() => {
    if (!data || data.byCategory.length < 2) return []
    const categories = data.byCategory.map((c) => c.category)
    const alreadyMerged = new Set(mergedCategories.keys())
    const pairs: SimilarPair[] = []
    for (let i = 0; i < categories.length; i++) {
      if (alreadyMerged.has(categories[i])) continue
      for (let j = i + 1; j < categories.length; j++) {
        if (alreadyMerged.has(categories[j])) continue
        const sim = levenshteinSimilarity(categories[i], categories[j])
        if (sim >= 0.7 && sim < 1) {
          pairs.push({ a: categories[i], b: categories[j], similarity: sim })
        }
      }
    }
    return pairs.sort((x, y) => y.similarity - x.similarity)
  }, [data, mergedCategories])

  const facilityRows = useMemo<FacilityRow[]>(() => {
    if (!data) return []
    const totalFacilitySpend = data.byFacility.reduce((s, f) => s + f.share, 0)
    return data.byFacility
      .map((f) => ({
        facility: f.facility,
        yourSpend: f.share,
        totalSpend: totalFacilitySpend,
        sharePct:
          totalFacilitySpend > 0
            ? Math.round((f.share / totalFacilitySpend) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.sharePct - a.sharePct)
  }, [data])

  const handleMerge = useCallback((source: string, target: string) => {
    setMergedCategories((prev) => {
      const next = new Map(prev)
      next.set(source, target)
      return next
    })
  }, [])

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Share Analysis"
        description="Your market share across categories and facilities"
        action={
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ytd">Year to Date</SelectItem>
              <SelectItem value="qtd">Quarter to Date</SelectItem>
              <SelectItem value="12m">Last 12 Months</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {isLoading || !data || !stats ? (
        <div className="space-y-6">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-10 w-[420px] rounded-md" />
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
      ) : (
        <>
          <MarketShareHero stats={stats} categoryRows={categoryRows} />

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="categories">By Category</TabsTrigger>
              <TabsTrigger value="facilities">By Facility</TabsTrigger>
              <TabsTrigger value="competitors">Competitors</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6 mt-6">
              <MarketShareCharts data={data} />
              <GrowthOpportunitiesSection
                categoryRows={categoryRows}
                facilityRows={facilityRows}
              />
            </TabsContent>

            <TabsContent value="categories" className="space-y-6 mt-6">
              <SimilarCategoriesAlert pairs={similarPairs} onMerge={handleMerge} />
              <CategoryTableSection
                categoryRows={categoryRows}
                stats={stats}
                mergedCount={mergedCategories.size}
              />
              <CategoryBreakdownSection categoryRows={categoryRows} />
            </TabsContent>

            <TabsContent value="facilities" className="space-y-6 mt-6">
              <FacilityTableSection facilityRows={facilityRows} />
            </TabsContent>

            <TabsContent value="competitors" className="space-y-6 mt-6">
              <CompetitorsSection categoryRows={categoryRows} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

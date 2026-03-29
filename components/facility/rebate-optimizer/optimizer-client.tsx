"use client"

import { useState, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { OptimizerChart } from "./optimizer-chart"
import { OpportunityList } from "./opportunity-list"
import { SpendTargetDialog } from "./spend-target-dialog"
import { useRebateOpportunities, useSetSpendTarget } from "@/hooks/use-rebate-optimizer"
import { formatCurrency } from "@/lib/formatting"
import { DollarSign, TrendingUp, Target } from "lucide-react"
import { toast } from "sonner"
import { motion } from "motion/react"
import { staggerContainer, fadeInUp } from "@/lib/animations"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface OptimizerClientProps {
  facilityId: string
}

export function RebateOptimizerClient({ facilityId }: OptimizerClientProps) {
  const [targetOpp, setTargetOpp] = useState<RebateOpportunity | null>(null)
  const [vendorFilter, setVendorFilter] = useState("all")

  const { data: opportunities, isLoading } = useRebateOpportunities(facilityId)
  const setTarget = useSetSpendTarget()

  // Unique vendors for filter
  const vendors = useMemo(() => {
    if (!opportunities) return []
    return [...new Set(opportunities.map((o) => o.vendorName))]
  }, [opportunities])

  // Filtered opportunities
  const filtered = useMemo(() => {
    if (!opportunities) return []
    if (vendorFilter === "all") return opportunities
    return opportunities.filter((o) => o.vendorName === vendorFilter)
  }, [opportunities, vendorFilter])

  // Summary stats
  const stats = useMemo(() => {
    if (!opportunities)
      return { totalOpportunities: 0, potentialRebates: 0, nearNextTier: 0 }
    const totalOpportunities = opportunities.length
    const potentialRebates = opportunities.reduce(
      (sum, o) => sum + o.projectedAdditionalRebate,
      0
    )
    const nearNextTier = opportunities.filter(
      (o) => o.percentToNextTier >= 70
    ).length
    return { totalOpportunities, potentialRebates, nearNextTier }
  }, [opportunities])

  async function handleSetTarget(target: number, date: string) {
    if (!targetOpp) return
    try {
      await setTarget.mutateAsync({
        contractId: targetOpp.contractId,
        facilityId,
        targetSpend: target,
        targetDate: date,
      })
      toast.success("Spend target set successfully")
    } catch {
      toast.error("Failed to set spend target")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rebate Optimizer"
        description="Identify opportunities to maximize rebate tiers across your contracts"
        action={
          vendors.length > 1 ? (
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
      ) : (
        <motion.div
          className="grid gap-4 md:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total Opportunities
                    </p>
                    <p className="text-2xl font-bold">
                      {stats.totalOpportunities}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      contracts with upside
                    </p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-blue-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Potential Additional Rebates
                    </p>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(stats.potentialRebates)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      if next tiers reached
                    </p>
                  </div>
                  <DollarSign className="h-8 w-8 text-green-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Contracts Near Next Tier
                    </p>
                    <p className="text-2xl font-bold">{stats.nearNextTier}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      70%+ to threshold
                    </p>
                  </div>
                  <Target className="h-8 w-8 text-amber-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* Chart + Cards */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[380px] rounded-xl" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[260px] rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <OptimizerChart opportunities={filtered} />
          <OpportunityList
            opportunities={filtered}
            onSetTarget={setTargetOpp}
          />
        </>
      )}

      <SpendTargetDialog
        opportunity={targetOpp}
        open={!!targetOpp}
        onOpenChange={(open) => {
          if (!open) setTargetOpp(null)
        }}
        onSave={handleSetTarget}
      />
    </div>
  )
}

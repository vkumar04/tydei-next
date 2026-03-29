"use client"

import { OpportunityCard } from "./opportunity-card"
import { EmptyState } from "@/components/shared/empty-state"
import { TrendingUp } from "lucide-react"
import { motion } from "motion/react"
import { staggerContainer } from "@/lib/animations"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface OpportunityListProps {
  opportunities: RebateOpportunity[]
  onSetTarget: (opp: RebateOpportunity) => void
}

export function OpportunityList({
  opportunities,
  onSetTarget,
}: OpportunityListProps) {
  if (opportunities.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No Optimization Opportunities"
        description="All contracts are at their highest available tier, or no tiered contracts were found."
      />
    )
  }

  return (
    <motion.div
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {opportunities.map((opp) => (
        <OpportunityCard
          key={`${opp.contractId}-${opp.currentTier}`}
          opportunity={opp}
          onSetTarget={() => onSetTarget(opp)}
        />
      ))}
    </motion.div>
  )
}

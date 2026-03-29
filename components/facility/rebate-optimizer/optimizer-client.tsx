"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { OptimizerChart } from "./optimizer-chart"
import { OpportunityList } from "./opportunity-list"
import { SpendTargetDialog } from "./spend-target-dialog"
import { useRebateOpportunities, useSetSpendTarget } from "@/hooks/use-rebate-optimizer"
import { toast } from "sonner"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface OptimizerClientProps {
  facilityId: string
}

export function RebateOptimizerClient({ facilityId }: OptimizerClientProps) {
  const [targetOpp, setTargetOpp] = useState<RebateOpportunity | null>(null)

  const { data: opportunities, isLoading } = useRebateOpportunities(facilityId)
  const setTarget = useSetSpendTarget()

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
      />

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
          <OptimizerChart opportunities={opportunities ?? []} />
          <OpportunityList
            opportunities={opportunities ?? []}
            onSetTarget={setTargetOpp}
          />
        </>
      )}

      <SpendTargetDialog
        opportunity={targetOpp}
        open={!!targetOpp}
        onOpenChange={(open) => { if (!open) setTargetOpp(null) }}
        onSave={handleSetTarget}
      />
    </div>
  )
}

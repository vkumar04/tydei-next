"use client"

import { useId, useMemo, useState } from "react"
import Link from "next/link"
import { Sparkles, Zap } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useRebateOpportunities,
  useRebateOptimizerEngine,
} from "@/hooks/use-rebate-optimizer"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"
import type { RebateOpportunity as EngineRebateOpportunity } from "@/lib/actions/rebate-optimizer-engine"
import { AiInsightsPanel } from "./ai-insights-panel"
import { CompareScenariosTable } from "./compare-scenarios-table"
import { ContractsTierProgress } from "./contracts-tier-progress"
import { EarningsChart } from "./earnings-chart"
import { OpportunitiesRecommendations } from "./opportunities-recommendations"
import { ThresholdOpportunitiesCard } from "./threshold-opportunities-card"
import { RebateCalculatorDialog } from "./rebate-calculator-dialog"
import {
  RebateOptimizerHero,
  type RebateOptimizerHeroStats,
} from "./optimizer-hero"
import { RebateOptimizerControlBar } from "./optimizer-control-bar"
import { ResultCards } from "./result-cards"
import { ScenarioBuilder, type RebateScenarioInput } from "./scenario-builder"
import { SensitivityChart } from "./sensitivity-chart"
import { evaluateScenario } from "./scenario-math"
import type { SavedScenario } from "./scenario-types"
import { useOptimizerAiInsights } from "./use-optimizer-ai-insights"

/**
 * Rebate Optimizer page orchestrator — hero + tabbed details.
 *
 * Layout (2026-04-22 redesign, mirrors the Financial Analysis page):
 *
 *   1. ControlBar — vendor filter + contract count + "Reports" link.
 *   2. Hero — three big-number KPIs (Earned YTD, Potential Additional,
 *      Close to Next Tier) + best-opportunity callout.
 *   3. AI Smart Recommendations — collapsible card (neutral styling).
 *   4. Tabs — Contracts / Earnings / Scenarios / Opportunities /
 *      Sensitivity. Each tab is conditional on the data it needs.
 *
 * Replaces the old `color-left-border` card farm + stacked chart grid.
 */
interface OptimizerClientProps {
  facilityId: string
}

export function RebateOptimizerClient({ facilityId }: OptimizerClientProps) {
  // ─── Vendor filter ────────────────────────────────────────────
  const [vendorFilter, setVendorFilter] = useState("all")

  // ─── Calculator dialog state ──────────────────────────────────
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [selectedContract, setSelectedContract] =
    useState<RebateOpportunity | null>(null)
  const [additionalSpend, setAdditionalSpend] = useState("")

  const handleOpenCalculator = (opp: RebateOpportunity) => {
    setSelectedContract(opp)
    setCalculatorOpen(true)
    setAdditionalSpend("")
  }

  // ─── AI Smart Recommendations ─────────────────────────────────
  const ai = useOptimizerAiInsights(facilityId)

  // ─── Data ─────────────────────────────────────────────────────
  const { data: opportunities, isLoading } = useRebateOpportunities(facilityId)

  const vendors = useMemo(() => {
    if (!opportunities) return []
    return [...new Set(opportunities.map((o) => o.vendorName))]
  }, [opportunities])

  const filtered = useMemo(() => {
    if (!opportunities) return []
    if (vendorFilter === "all") return opportunities
    return opportunities.filter((o) => o.vendorName === vendorFilter)
  }, [opportunities, vendorFilter])

  const stats = useMemo<RebateOptimizerHeroStats>(() => {
    if (!opportunities) {
      return {
        totalEarned: 0,
        totalPotential: 0,
        highUrgency: 0,
        contractCount: 0,
      }
    }
    const totalEarned = opportunities.reduce(
      (sum, o) => sum + (o.currentSpend * (o.currentRebatePercent || 0)) / 100,
      0,
    )
    const totalPotential = opportunities.reduce(
      (sum, o) => sum + o.projectedAdditionalRebate,
      0,
    )
    const highUrgency = opportunities.filter(
      (o) => o.percentToNextTier >= 70,
    ).length
    return {
      totalEarned,
      totalPotential,
      highUrgency,
      contractCount: opportunities.length,
    }
  }, [opportunities])

  const sortedOpportunities = useMemo(() => {
    return [...filtered].sort(
      (a, b) => b.projectedAdditionalRebate - a.projectedAdditionalRebate,
    )
  }, [filtered])

  const bestOpp = sortedOpportunities[0] ?? null
  const aiHeadline = ai.data?.insights?.[0]?.title ?? null

  // ─── Scenario builder state ───────────────────────────────────
  const scenarioIdSeed = useId()
  const { data: engineData, isLoading: isEngineLoading } =
    useRebateOptimizerEngine(facilityId)
  const engineOpportunities: EngineRebateOpportunity[] = useMemo(
    () => engineData?.opportunities ?? [],
    [engineData],
  )
  const [scenarios, setScenarios] = useState<SavedScenario[]>([])
  const [activeOpportunityId, setActiveOpportunityId] = useState<string | null>(
    null,
  )

  const activeOpportunity = useMemo<EngineRebateOpportunity | null>(() => {
    if (activeOpportunityId) {
      const match = engineOpportunities.find(
        (o) => o.contractId === activeOpportunityId,
      )
      if (match) return match
    }
    return engineOpportunities[0] ?? null
  }, [engineOpportunities, activeOpportunityId])

  const latestEvaluation = useMemo(() => {
    if (scenarios.length === 0) return null
    const sameContract = [...scenarios]
      .reverse()
      .find((s) => s.input.contractId === activeOpportunity?.contractId)
    if (sameContract) return sameContract.evaluation
    return scenarios[scenarios.length - 1]?.evaluation ?? null
  }, [scenarios, activeOpportunity])

  const optimalScenario = useMemo(() => {
    if (scenarios.length === 0) return null
    return scenarios.reduce<SavedScenario | null>((best, s) => {
      if (!best) return s
      return s.evaluation.rebateDelta > best.evaluation.rebateDelta ? s : best
    }, null)
  }, [scenarios])

  function handleAddScenario(input: RebateScenarioInput) {
    const evaluation = evaluateScenario(input.opportunity, input.projectedSpend)
    const id = `${scenarioIdSeed}-${scenarios.length}-${Date.now()}`
    setScenarios((prev) => [
      ...prev,
      { id, input, evaluation, createdAt: Date.now() },
    ])
    setActiveOpportunityId(input.opportunity.contractId)
  }

  function handleRemoveScenario(id: string) {
    setScenarios((prev) => prev.filter((s) => s.id !== id))
  }

  function handleClearScenarios() {
    setScenarios([])
  }

  // ─── Tab availability ─────────────────────────────────────────
  const hasContracts = !isLoading && filtered.length > 0
  const hasEarnings = !isLoading && filtered.length > 0
  const hasScenarios = !isEngineLoading && engineOpportunities.length > 0
  const hasOpportunities = !isLoading && sortedOpportunities.length > 0
  const hasSensitivity = hasScenarios

  const defaultTab = hasContracts
    ? "contracts"
    : hasScenarios
      ? "scenarios"
      : hasOpportunities
        ? "opportunities"
        : "contracts"

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Spend Rebate Tier Optimizer
          </h1>
          {/*
           * Charles 2026-04-25 (audit follow-up): the optimizer
           * engine only models SPEND_REBATE tiers today (carve-out
           * and PO-rebate are recognized as eligibility filters but
           * don't have what-if modeling). The page used to imply
           * coverage of all 15 term types via its name; the rename
           * + the line below make the actual scope explicit so users
           * with volume / compliance / market-share contracts know
           * where to look (the contract detail page's
           * Performance tab) until those engines get optimizer
           * coverage too.
           */}
          <p className="text-sm text-muted-foreground">
            Maximize rebate earnings by reaching higher tier thresholds on
            spend-rebate contracts. Volume, market-share, compliance, and
            other rebate types are evaluated on each contract&apos;s detail
            page; broader optimizer coverage is on the roadmap.
          </p>
        </div>
      </div>

      {/* Control bar */}
      <RebateOptimizerControlBar
        vendors={vendors}
        vendorFilter={vendorFilter}
        onVendorFilterChange={setVendorFilter}
        contractCount={stats.contractCount}
      />

      {/* Hero */}
      {isLoading ? (
        <Skeleton className="h-[260px] rounded-xl" />
      ) : (
        <RebateOptimizerHero
          stats={stats}
          bestOpportunity={bestOpp}
          aiHeadline={aiHeadline}
        />
      )}

      {/* Quick-win alert (kept — action-oriented, not a KPI) */}
      {stats.highUrgency > 0 && (
        <Alert>
          <Zap className="h-4 w-4" />
          <AlertTitle>Quick Win opportunities</AlertTitle>
          <AlertDescription>
            {stats.highUrgency} contract(s) are within 30% of the next rebate
            tier. Consider consolidating purchases to maximize rebates before
            period end.
          </AlertDescription>
        </Alert>
      )}

      {/* AI Smart Recommendations */}
      <AiInsightsPanel
        open={ai.open}
        onOpenChange={ai.setOpen}
        insightsEnabled={ai.enabled}
        insightsData={ai.data}
        insightsLoading={ai.loading}
        insightsError={ai.error}
        regeneratePending={ai.regeneratePending}
        flags={ai.flags}
        flaggedInsightIds={ai.flaggedIds}
        flagPending={ai.flagPending}
        clearPending={ai.clearPending}
        onGenerate={ai.onGenerate}
        onRegenerate={ai.onRegenerate}
        onFlag={ai.onFlag}
        onClearFlag={ai.onClearFlag}
      />
      {/* Tabs — Contracts / Earnings / Scenarios / Opportunities / Sensitivity */}
      {isLoading && isEngineLoading ? (
        <Skeleton className="h-[480px] rounded-xl" />
      ) : !hasContracts && !hasScenarios && !hasOpportunities ? (
        <EmptyState
          icon={Sparkles}
          title="No optimizable contracts"
          description="Add contracts with tiered spend rebates to start maximizing rebate earnings."
          action={
            <Button asChild>
              <Link href="/dashboard/contracts">Go to Contracts</Link>
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList>
            {hasContracts && (
              <TabsTrigger value="contracts">Contracts</TabsTrigger>
            )}
            {hasEarnings && (
              <TabsTrigger value="earnings">Earnings</TabsTrigger>
            )}
            {hasScenarios && (
              <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            )}
            {hasOpportunities && (
              <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
            )}
            {hasSensitivity && (
              <TabsTrigger value="sensitivity">Sensitivity</TabsTrigger>
            )}
          </TabsList>

          {hasContracts && (
            <TabsContent value="contracts" className="mt-4">
              <TabPanel
                title="Contract tier progress"
                description="Track progress toward rebate tier thresholds for each contract."
              >
                <ContractsTierProgress
                  contracts={filtered}
                  onOpenCalculator={handleOpenCalculator}
                />
              </TabPanel>
            </TabsContent>
          )}

          {hasEarnings && (
            <TabsContent value="earnings" className="mt-4">
              <TabPanel
                title="Rebate earnings by contract"
                description="Current earned vs. potential additional rebates per contract."
              >
                <EarningsChart opportunities={filtered} />
              </TabPanel>
            </TabsContent>
          )}

          {hasScenarios && (
            <TabsContent value="scenarios" className="mt-4 space-y-6">
              <ScenarioBuilder
                opportunities={engineOpportunities}
                onAddScenario={handleAddScenario}
              />
              <ResultCards
                opportunity={activeOpportunity}
                currentEvaluation={latestEvaluation}
                optimalScenario={
                  optimalScenario
                    ? {
                        label: optimalScenario.input.label,
                        evaluation: optimalScenario.evaluation,
                      }
                    : null
                }
              />
              <CompareScenariosTable
                scenarios={scenarios}
                optimalId={optimalScenario?.id ?? null}
                onRemove={handleRemoveScenario}
                onClearAll={handleClearScenarios}
              />
            </TabsContent>
          )}

          {hasOpportunities && (
            <TabsContent value="opportunities" className="mt-4 space-y-4">
              <TabPanel
                title="Top ranked opportunities"
                description="Contracts sorted by potential additional rebate."
              >
                <OpportunitiesRecommendations
                  opportunities={sortedOpportunities}
                  onOpenCalculator={handleOpenCalculator}
                />
              </TabPanel>
              {/* Charles 2026-04-25: companion to the spend optimizer
                  for compliance_rebate + market_share term types. */}
              <ThresholdOpportunitiesCard />
            </TabsContent>
          )}

          {hasSensitivity && (
            <TabsContent value="sensitivity" className="mt-4">
              <SensitivityChart
                opportunity={activeOpportunity}
                activeEvaluation={latestEvaluation}
              />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Calculator dialog — rendered once at root */}
      <RebateCalculatorDialog
        open={calculatorOpen}
        onOpenChange={setCalculatorOpen}
        contract={selectedContract}
        additionalSpend={additionalSpend}
        onAdditionalSpendChange={setAdditionalSpend}
      />
    </div>
  )
}

interface TabPanelProps {
  title: string
  description: string
  children: React.ReactNode
}

function TabPanel({ title, description, children }: TabPanelProps) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

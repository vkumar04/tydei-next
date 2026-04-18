"use client"

/**
 * Scenario Builder form.
 *
 * Lets the user construct a what-if rebate scenario by:
 *   1. picking a contract (opportunity row from the engine action)
 *   2. choosing the rebate type (pre-filled from the underlying term; the
 *      full list of 8 types from the unified engine is exposed as a display
 *      selector so users can see which type they're simulating)
 *   3. entering a projected spend amount
 *   4. optionally overriding market-share % and tier number
 *
 * The form emits a fully-shaped `RebateScenarioInput` on submit. Parent
 * handles scenario evaluation and accumulation.
 */

import { useEffect, useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Plus, Sparkles } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer-engine"

// ─── Rebate type catalogue (matches `lib/rebates/engine/types.ts`) ─
// Exposed as display-only so users understand what math drives the
// scenario. The underlying term's actual type is unchanged; this is a
// labelling convenience.

export const REBATE_TYPE_OPTIONS = [
  { value: "SPEND_REBATE", label: "Spend Rebate" },
  { value: "VOLUME_REBATE", label: "Volume Rebate" },
  { value: "TIER_PRICE_REDUCTION", label: "Tier Price Reduction" },
  { value: "MARKET_SHARE_REBATE", label: "Market Share Rebate" },
  { value: "MARKET_SHARE_PRICE_REDUCTION", label: "Market Share Price Reduction" },
  { value: "CAPITATED", label: "Capitated" },
  { value: "CARVE_OUT", label: "Carve Out" },
  { value: "TIE_IN_CAPITAL", label: "Tie-In Capital" },
] as const

export type RebateTypeOption = (typeof REBATE_TYPE_OPTIONS)[number]["value"]

export interface RebateScenarioInput {
  label: string
  contractId: string
  contractName: string
  vendorName: string
  rebateType: RebateTypeOption
  /** Total projected spend (absolute, not delta). */
  projectedSpend: number
  /** Optional override for market-share scenarios (0–100). */
  marketSharePercent: number | null
  /** Optional override for target tier. */
  tierOverride: number | null
  /** Echoed opportunity snapshot — the parent uses this to compute rebate math. */
  opportunity: RebateOpportunity
}

interface ScenarioBuilderProps {
  opportunities: RebateOpportunity[]
  onAddScenario: (scenario: RebateScenarioInput) => void
}

export function ScenarioBuilder({
  opportunities,
  onAddScenario,
}: ScenarioBuilderProps) {
  const [contractId, setContractId] = useState<string>("")
  const [rebateType, setRebateType] = useState<RebateTypeOption>("SPEND_REBATE")
  const [projectedSpend, setProjectedSpend] = useState<string>("")
  const [marketShare, setMarketShare] = useState<string>("")
  const [tierOverride, setTierOverride] = useState<string>("")

  // Default to the first opportunity when the list first loads.
  useEffect(() => {
    if (!contractId && opportunities.length > 0) {
      const first = opportunities[0]
      if (first) {
        setContractId(first.contractId)
        setProjectedSpend(
          (first.currentSpend + first.spendNeeded).toFixed(0),
        )
      }
    }
  }, [opportunities, contractId])

  const selected = useMemo<RebateOpportunity | null>(() => {
    return (
      opportunities.find((o) => o.contractId === contractId) ?? null
    )
  }, [opportunities, contractId])

  const parsedSpend = Number(projectedSpend)
  const parsedShare = marketShare === "" ? null : Number(marketShare)
  const parsedTier = tierOverride === "" ? null : Number(tierOverride)

  const canSubmit =
    selected !== null &&
    Number.isFinite(parsedSpend) &&
    parsedSpend > 0 &&
    (parsedShare === null ||
      (Number.isFinite(parsedShare) && parsedShare >= 0 && parsedShare <= 100)) &&
    (parsedTier === null || (Number.isFinite(parsedTier) && parsedTier >= 1))

  function handleAdd() {
    if (!selected || !canSubmit) return
    const label = `${selected.vendorName} — ${formatCurrency(parsedSpend)}`
    onAddScenario({
      label,
      contractId: selected.contractId,
      contractName: selected.contractName,
      vendorName: selected.vendorName,
      rebateType,
      projectedSpend: parsedSpend,
      marketSharePercent: parsedShare,
      tierOverride: parsedTier,
      opportunity: selected,
    })
  }

  if (opportunities.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Scenario Builder
        </CardTitle>
        <CardDescription>
          Model a what-if rebate scenario. Pick a contract, choose the rebate
          type, and enter projected spend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {/* Contract picker */}
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="scenario-contract">Contract</Label>
            <Select value={contractId} onValueChange={setContractId}>
              <SelectTrigger id="scenario-contract">
                <SelectValue placeholder="Select contract" />
              </SelectTrigger>
              <SelectContent>
                {opportunities.map((o) => (
                  <SelectItem key={o.contractId} value={o.contractId}>
                    {o.vendorName} — {o.contractName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Rebate type */}
          <div className="space-y-2">
            <Label htmlFor="scenario-rebate-type">Rebate Type</Label>
            <Select
              value={rebateType}
              onValueChange={(v) => setRebateType(v as RebateTypeOption)}
            >
              <SelectTrigger id="scenario-rebate-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {REBATE_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Projected spend */}
          <div className="space-y-2">
            <Label htmlFor="scenario-spend">Projected Spend ($)</Label>
            <Input
              id="scenario-spend"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="0"
              value={projectedSpend}
              onChange={(e) => setProjectedSpend(e.target.value)}
            />
          </div>

          {/* Tier override */}
          <div className="space-y-2">
            <Label htmlFor="scenario-tier">
              Target Tier
              <span className="ml-1 text-xs text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="scenario-tier"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={selected ? String(selected.nextTierNumber) : "—"}
              value={tierOverride}
              onChange={(e) => setTierOverride(e.target.value)}
            />
          </div>
        </div>

        {/* Market share — only meaningful for MARKET_SHARE_* types but shown
            always so the form has a consistent layout. */}
        {(rebateType === "MARKET_SHARE_REBATE" ||
          rebateType === "MARKET_SHARE_PRICE_REDUCTION") && (
          <div className="mt-4 max-w-sm space-y-2">
            <Label htmlFor="scenario-share">Market Share (%)</Label>
            <Input
              id="scenario-share"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.1"
              placeholder="0–100"
              value={marketShare}
              onChange={(e) => setMarketShare(e.target.value)}
            />
          </div>
        )}

        {selected && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              Current spend {formatCurrency(selected.currentSpend)}
            </Badge>
            <Badge variant="outline">
              Next tier at {formatCurrency(selected.nextTierThreshold)}
            </Badge>
            <Badge variant="outline">
              {selected.nextRebateRate}% rebate
            </Badge>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={handleAdd} disabled={!canSubmit}>
            <Plus className="mr-2 h-4 w-4" />
            Add Scenario
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

"use client"

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Gauge, AlertTriangle, TrendingUp, Sparkles, DollarSign } from "lucide-react"
import { toast } from "sonner"

import { formatCurrency, formatPercent } from "@/lib/formatting"
import {
  getVendorProspectiveAnalysis,
  type VendorProspectiveAnalysisInput,
} from "@/lib/actions/vendor-prospective"
import type {
  VendorContractVariant,
  VendorProspectiveResult,
} from "@/lib/prospective-analysis/vendor-prospective-analyzer"

// ─── Types ─────────────────────────────────────────────────────

interface FacilityOption {
  id: string
  name: string
}

interface DealScorerSectionProps {
  facilities: FacilityOption[]
}

interface ScenarioForm {
  scenarioName: string
  unitPrice: string
  estimatedAnnualVolume: string
  rebatePercent: string
}

const DEFAULT_SCENARIOS: ScenarioForm[] = [
  { scenarioName: "Floor", unitPrice: "", estimatedAnnualVolume: "", rebatePercent: "0" },
  { scenarioName: "Target", unitPrice: "", estimatedAnnualVolume: "", rebatePercent: "0" },
  { scenarioName: "Ceiling", unitPrice: "", estimatedAnnualVolume: "", rebatePercent: "0" },
]

// ─── Section ───────────────────────────────────────────────────

export function DealScorerSection({ facilities }: DealScorerSectionProps) {
  const [facilityId, setFacilityId] = useState<string>("")
  const [contractVariant, setContractVariant] =
    useState<VendorContractVariant>("USAGE_SPEND")
  const [scenarios, setScenarios] = useState<ScenarioForm[]>(DEFAULT_SCENARIOS)
  const [targetMargin, setTargetMargin] = useState("40")
  const [floorMargin, setFloorMargin] = useState("25")
  const [currentShare, setCurrentShare] = useState("")
  const [targetShare, setTargetShare] = useState("")
  const [estimatedSpend, setEstimatedSpend] = useState("")
  const [equipmentCost, setEquipmentCost] = useState("")
  const [maintenanceCost, setMaintenanceCost] = useState("")

  const isCapital = useMemo(
    () =>
      contractVariant === "CAPITAL_OUTRIGHT" ||
      contractVariant === "CAPITAL_LEASE" ||
      contractVariant === "CAPITAL_TIE_IN",
    [contractVariant],
  )

  const mutation = useMutation({
    mutationFn: (input: VendorProspectiveAnalysisInput) =>
      getVendorProspectiveAnalysis(input),
    onError: (err: Error) =>
      toast.error(err.message || "Failed to analyze deal"),
  })

  function handleAnalyze() {
    if (!facilityId) {
      toast.error("Select a facility first")
      return
    }
    const validScenarios = scenarios
      .filter((s) => s.unitPrice && s.estimatedAnnualVolume)
      .map((s) => ({
        scenarioName: s.scenarioName,
        unitPrice: Number(s.unitPrice),
        estimatedAnnualVolume: Number(s.estimatedAnnualVolume),
        rebatePercent: Number(s.rebatePercent || "0"),
      }))

    if (validScenarios.length === 0) {
      toast.error("Enter at least one scenario with price + volume")
      return
    }

    mutation.mutate({
      facilityId,
      contractVariant,
      pricingScenarios: validScenarios,
      targetGrossMarginPercent: Number(targetMargin) / 100,
      minimumAcceptableGrossMarginPercent: Number(floorMargin) / 100,
      facilityEstimatedAnnualSpend: estimatedSpend
        ? Number(estimatedSpend)
        : undefined,
      facilityCurrentVendorShare: currentShare
        ? Number(currentShare) / 100
        : undefined,
      targetVendorShare: targetShare ? Number(targetShare) / 100 : undefined,
      capitalDetails:
        isCapital && equipmentCost
          ? {
              equipmentCost: Number(equipmentCost),
              annualMaintenanceCost: maintenanceCost
                ? Number(maintenanceCost)
                : 0,
              termMonths: 60,
              interestRate: 0.05,
              discountRate: 0.1,
            }
          : undefined,
    })
  }

  function updateScenario(idx: number, patch: Partial<ScenarioForm>) {
    setScenarios((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal Scorer</CardTitle>
          <CardDescription>
            Model floor / target / ceiling pricing and see margin, payback,
            and tier upside before you submit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="facility">Facility</Label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger id="facility">
                  <SelectValue placeholder="Select a facility..." />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="variant">Contract variant</Label>
              <Select
                value={contractVariant}
                onValueChange={(v) => setContractVariant(v as VendorContractVariant)}
              >
                <SelectTrigger id="variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USAGE_SPEND">Usage — Spend</SelectItem>
                  <SelectItem value="USAGE_VOLUME">Usage — Volume</SelectItem>
                  <SelectItem value="USAGE_MARKET_SHARE">Usage — Market Share</SelectItem>
                  <SelectItem value="CAPITAL_OUTRIGHT">Capital — Outright</SelectItem>
                  <SelectItem value="CAPITAL_LEASE">Capital — Lease</SelectItem>
                  <SelectItem value="CAPITAL_TIE_IN">Capital — Tie-in</SelectItem>
                  <SelectItem value="SERVICE_FIXED">Service — Fixed</SelectItem>
                  <SelectItem value="SERVICE_VARIABLE">Service — Variable</SelectItem>
                  <SelectItem value="GPO">GPO</SelectItem>
                  <SelectItem value="PRICING_ONLY">Pricing only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Pricing scenarios</Label>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-medium">Scenario</th>
                    <th className="p-2 text-left font-medium">Unit price ($)</th>
                    <th className="p-2 text-left font-medium">Annual volume</th>
                    <th className="p-2 text-left font-medium">Rebate %</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 font-medium">{s.scenarioName}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={s.unitPrice}
                          onChange={(e) =>
                            updateScenario(idx, { unitPrice: e.target.value })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={s.estimatedAnnualVolume}
                          onChange={(e) =>
                            updateScenario(idx, {
                              estimatedAnnualVolume: e.target.value,
                            })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={s.rebatePercent}
                          onChange={(e) =>
                            updateScenario(idx, { rebatePercent: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="target-margin">Target margin %</Label>
              <Input
                id="target-margin"
                type="number"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="floor-margin">Floor margin %</Label>
              <Input
                id="floor-margin"
                type="number"
                value={floorMargin}
                onChange={(e) => setFloorMargin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-share">Current share %</Label>
              <Input
                id="current-share"
                type="number"
                placeholder="optional"
                value={currentShare}
                onChange={(e) => setCurrentShare(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-share">Target share %</Label>
              <Input
                id="target-share"
                type="number"
                placeholder="optional"
                value={targetShare}
                onChange={(e) => setTargetShare(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="estimated-spend">
              Facility estimated annual category spend ($)
            </Label>
            <Input
              id="estimated-spend"
              type="number"
              placeholder="leave blank to use COG trailing-12mo"
              value={estimatedSpend}
              onChange={(e) => setEstimatedSpend(e.target.value)}
            />
          </div>

          {isCapital && (
            <div className="grid gap-4 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="equipment-cost">Equipment cost ($)</Label>
                <Input
                  id="equipment-cost"
                  type="number"
                  value={equipmentCost}
                  onChange={(e) => setEquipmentCost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maint-cost">Annual maintenance ($)</Label>
                <Input
                  id="maint-cost"
                  type="number"
                  value={maintenanceCost}
                  onChange={(e) => setMaintenanceCost(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleAnalyze} disabled={mutation.isPending}>
              <Gauge className="mr-2 h-4 w-4" />
              {mutation.isPending ? "Analyzing…" : "Analyze deal"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {mutation.data && <ResultsView result={mutation.data} />}
    </div>
  )
}

// ─── Results ───────────────────────────────────────────────────

function ResultsView({ result }: { result: VendorProspectiveResult }) {
  return (
    <div className="space-y-4">
      {result.warnings.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <ul className="space-y-1 text-sm">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ScenarioTable result={result} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PenetrationCard result={result} />
        <TierOptimizationCard result={result} />
      </div>

      {result.capitalAnalysis && <CapitalCard result={result} />}
    </div>
  )
}

function ScenarioTable({ result }: { result: VendorProspectiveResult }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Scenario margin analysis</CardTitle>
        <CardDescription>
          Recommended scenario:{" "}
          {result.recommendedScenario ? (
            <span className="font-semibold">
              {result.recommendedScenario.scenarioName} —{" "}
              {formatPercent(result.recommendedScenario.grossMarginPercent * 100)} margin
            </span>
          ) : (
            <span className="text-red-600">none meet floor</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2 font-medium">Scenario</th>
                <th className="p-2 font-medium">Unit price</th>
                <th className="p-2 font-medium">Annual revenue</th>
                <th className="p-2 font-medium">Rebate paid</th>
                <th className="p-2 font-medium">Net revenue</th>
                <th className="p-2 font-medium">Gross margin</th>
                <th className="p-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {result.scenarioResults.map((s) => {
                const isRecommended =
                  result.recommendedScenario?.scenarioName === s.scenarioName
                return (
                  <tr
                    key={s.scenarioName}
                    className={
                      isRecommended
                        ? "border-t bg-emerald-50/50 dark:bg-emerald-950/20"
                        : "border-t"
                    }
                  >
                    <td className="p-2 font-medium">
                      {s.scenarioName}
                      {isRecommended && (
                        <Sparkles className="ml-1 inline h-3 w-3 text-emerald-600" />
                      )}
                    </td>
                    <td className="p-2">{formatCurrency(s.unitPrice)}</td>
                    <td className="p-2">{formatCurrency(s.annualRevenue)}</td>
                    <td className="p-2">{formatCurrency(s.annualRebatePaid)}</td>
                    <td className="p-2">{formatCurrency(s.netRevenue)}</td>
                    <td className="p-2">
                      {formatPercent(s.grossMarginPercent * 100)}
                    </td>
                    <td className="p-2">
                      {!s.meetsFloorMargin ? (
                        <Badge variant="destructive">below floor</Badge>
                      ) : s.meetsTargetMargin ? (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                          meets target
                        </Badge>
                      ) : (
                        <Badge variant="secondary">above floor</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function PenetrationCard({ result }: { result: VendorProspectiveResult }) {
  const p = result.penetrationAnalysis
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Penetration & revenue at risk
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Current share" value={formatPercent(p.currentShare * 100)} />
        <Row label="Target share" value={formatPercent(p.targetShare * 100)} />
        <Row
          label="Current revenue"
          value={formatCurrency(p.currentAnnualRevenue)}
        />
        <Row
          label="Target revenue"
          value={formatCurrency(p.targetAnnualRevenue)}
        />
        <Row
          label="Incremental opportunity"
          value={formatCurrency(p.incrementalRevenueOpportunity)}
          emphasis
        />
        <Row
          label="Revenue at risk"
          value={formatCurrency(result.revenueAtRisk)}
          emphasis
        />
      </CardContent>
    </Card>
  )
}

function TierOptimizationCard({ result }: { result: VendorProspectiveResult }) {
  const t = result.tierOptimization
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          Tier optimization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row
          label="Achieved tier"
          value={
            t.achievedTier
              ? (t.achievedTier.tierName ?? `Tier ${t.achievedTier.tierNumber}`)
              : "none"
          }
        />
        {t.distanceToNextTier != null && (
          <Row
            label="Distance to next"
            value={formatCurrency(t.distanceToNextTier)}
          />
        )}
        {t.additionalRebateAtNextTier != null && (
          <Row
            label="Additional rebate at next"
            value={formatCurrency(t.additionalRebateAtNextTier)}
          />
        )}
        <p className="border-t pt-3 text-muted-foreground">{t.recommendation}</p>
      </CardContent>
    </Card>
  )
}

function CapitalCard({ result }: { result: VendorProspectiveResult }) {
  const c = result.capitalAnalysis!
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Capital ROI
        </CardTitle>
        <CardDescription>
          Recommended-scenario net revenue applied against equipment cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-2">
        <Row label="Equipment cost" value={formatCurrency(c.equipmentCost)} />
        <Row
          label="Annual maintenance"
          value={formatCurrency(c.annualMaintenanceCost)}
        />
        <Row label="Total deal value" value={formatCurrency(c.totalDealValue)} emphasis />
        <Row
          label="Payback"
          value={
            c.paybackYears != null
              ? `${c.paybackYears.toFixed(1)} yrs`
              : "never (margin too thin)"
          }
        />
        <Row label="NPV @ 10%" value={formatCurrency(c.npv)} emphasis />
        {c.facilityBreakEvenPaymentPerPeriod != null && (
          <Row
            label="Facility break-even / mo"
            value={formatCurrency(c.facilityBreakEvenPaymentPerPeriod)}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasis ? "font-semibold" : ""}>{value}</span>
    </div>
  )
}

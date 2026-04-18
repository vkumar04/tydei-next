"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Copy } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { getRebateCalculationAudit } from "@/lib/actions/reports/audit-trail"
import {
  computeTierProgressProjection,
  type TierRow,
} from "@/lib/reports/tier-progress-projection"
import type { ReportsContract } from "./reports-types"

/**
 * Calculations tab — full rebate calculation audit trail.
 * Renders contract info, tier structure, formula, included POs,
 * excluded POs (grouped by category), and a tier-progress projection.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.4
 */
export interface ReportsCalculationsTabProps {
  contracts: ReportsContract[]
  selectedContract: ReportsContract | null
  onSelectContract: (contractId: string) => void
}

export function ReportsCalculationsTab({
  contracts,
  selectedContract,
  onSelectContract,
}: ReportsCalculationsTabProps) {
  if (!selectedContract) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Calculation Audit</CardTitle>
          <CardDescription>
            Select a contract to view the full rebate calculation audit
            trail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select onValueChange={onSelectContract}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Choose a contract..." />
            </SelectTrigger>
            <SelectContent>
              {contracts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {c.vendorName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    )
  }

  return (
    <CalculationsForContract
      contractId={selectedContract.id}
      onClear={() => onSelectContract("all")}
    />
  )
}

function CalculationsForContract({
  contractId,
  onClear,
}: {
  contractId: string
  onClear: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "audit", contractId] as const,
    queryFn: () => getRebateCalculationAudit(contractId),
  })

  const projection = useMemo(() => {
    if (!data) return null
    // Map the audit tiers to the projection helper's shape. The
    // audit tiers carry `minSpend` + `rebateRate`; the helper wants
    // `thresholdMin` + `rebateValue`.
    const tiers: TierRow[] = data.tiers.map((t, idx) => ({
      tierNumber: idx + 1,
      tierName: t.name,
      thresholdMin: t.minSpend,
      thresholdMax: t.maxSpend,
      rebateValue: t.rebateRate,
    }))

    // Trailing-3-month spend rate from inclusions.
    const now = new Date()
    const threeMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 3,
      now.getDate(),
    )
    const recentSpend = data.inclusions
      .filter((i) => new Date(i.date).getTime() >= threeMonthsAgo.getTime())
      .reduce((s, i) => s + i.amount, 0)
    const monthlySpendRate = recentSpend / 3

    return computeTierProgressProjection({
      currentSpend: data.calc.totalEligibleSpend,
      tiers,
      monthlySpendRate,
    })
  }, [data])

  if (isLoading || !data) {
    return <Skeleton className="h-[600px] rounded-xl" />
  }

  return (
    <div className="space-y-6">
      {/* Contract info */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{data.contract.name}</CardTitle>
              <CardDescription>
                {data.contract.vendor} · {data.contract.type}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {formatDate(data.contract.effectiveDate)} –{" "}
                {formatDate(data.contract.expirationDate)}
              </Badge>
              <Button size="sm" variant="ghost" onClick={onClear}>
                Change
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tier structure */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Tier Structure</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline">Retroactive</Badge>
                </TooltipTrigger>
                <TooltipContent>{data.tierDefinition}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent>
          {data.tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tiers configured.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Tier</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Min Spend
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Max Spend
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Rate</th>
                    <th className="px-4 py-3 text-center font-medium">
                      Current
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.tiers.map((t) => (
                    <tr key={t.name} className="border-t">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-right">
                        {formatCurrency(t.minSpend)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {t.maxSpend === null
                          ? "—"
                          : formatCurrency(t.maxSpend)}
                      </td>
                      <td className="px-4 py-3 text-right">{t.rebateRate}%</td>
                      <td className="px-4 py-3 text-center">
                        {t.name === data.currentTier ? (
                          <Check className="inline h-4 w-4 text-primary" />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Formula */}
      <Card>
        <CardHeader>
          <CardTitle>Rebate Calculation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Stat
              label="Total Eligible Spend"
              value={formatCurrency(data.calc.totalEligibleSpend)}
            />
            <Stat
              label="Current Tier Rate"
              value={`${data.calc.currentTierRate}%`}
            />
            <Stat
              label="Gross Rebate"
              value={formatCurrency(data.calc.grossRebate)}
            />
            <Stat
              label="Net Rebate"
              value={formatCurrency(data.calc.netRebate)}
              accent="text-green-600 dark:text-green-400"
            />
          </div>

          {data.calc.adjustments.length > 0 && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="mb-2 font-medium">Adjustments</p>
              <ul className="space-y-1">
                {data.calc.adjustments.map((a, i) => (
                  <li
                    key={i}
                    className="flex justify-between text-muted-foreground"
                  >
                    <span>{a.description}</span>
                    <span
                      className={
                        a.amount >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      {a.amount >= 0 ? "+" : ""}
                      {formatCurrency(a.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <FormulaBlock
            label="Formula"
            text={data.calc.formula}
          />
          <FormulaBlock
            label="Detailed"
            text={data.calc.detailedFormula}
          />
        </CardContent>
      </Card>

      {/* Tier progress projection */}
      {projection &&
        projection.projection !== null &&
        projection.nextTierName !== null && (
          <Card>
            <CardHeader>
              <CardTitle>Tier Progress Projection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-4">
                <Stat
                  label="Current Spend"
                  value={formatCurrency(projection.currentSpend)}
                />
                <Stat
                  label="Next Tier"
                  value={projection.nextTierName ?? "—"}
                />
                <Stat
                  label="Spend Needed"
                  value={formatCurrency(projection.spendNeeded)}
                />
                <Stat
                  label="Additional Rebate If Reached"
                  value={formatCurrency(
                    projection.additionalRebateIfReached ?? 0,
                  )}
                  accent="text-green-600 dark:text-green-400"
                />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {projection.projection}
              </p>
            </CardContent>
          </Card>
        )}

      {/* Included POs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Included Purchases</CardTitle>
            <Badge variant="outline">{data.inclusions.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {data.inclusions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No included purchases.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">PO</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inclusions.map((p, i) => (
                    <tr key={`${p.poNumber}-${i}`} className="border-t">
                      <td className="px-4 py-3">{p.poNumber}</td>
                      <td className="px-4 py-3">{formatDate(p.date)}</td>
                      <td className="px-4 py-3 text-right">
                        {formatCurrency(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Excluded POs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Excluded Purchases</CardTitle>
            <Badge variant="outline">{data.excludedPOs.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.calc.exclusions.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Category</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Total Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.calc.exclusions.map((ex) => (
                    <tr key={ex.category} className="border-t">
                      <td className="px-4 py-3 capitalize">
                        {ex.category.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {ex.description}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatCurrency(ex.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.excludedPOs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No excluded purchases.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">PO</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.excludedPOs.map((p, i) => (
                    <tr key={`${p.poNumber}-${i}`} className="border-t">
                      <td className="px-4 py-3">{p.poNumber}</td>
                      <td className="px-4 py-3">{formatDate(p.date)}</td>
                      <td className="px-4 py-3 text-right">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="rounded-lg border bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${accent ?? ""}`}>{value}</p>
    </div>
  )
}

function FormulaBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <code className="block whitespace-pre-wrap break-all font-mono text-xs">
        {text}
      </code>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/formatting"
import {
  runTieInImpactAnalysis,
  type TieInBundleRebate,
} from "@/lib/contracts/tie-in-compliance"

/**
 * What-if scenario runner for an all-or-nothing tie-in bundle
 * (v0 spec §4 "Tie-In Impact Analysis"). Lets the user type
 * alternative spend allocations per member and see which scenarios
 * unlock base / bonus / accelerator rebate tiers.
 *
 * Read-only, client-side. Routed through the same
 * `runTieInImpactAnalysis` helper the oracle parity-checks against
 * v0, so the scenarios users explore agree with the reference math
 * exactly.
 */
export function BundleImpactAnalysisCard({
  members,
  bundle,
}: {
  members: Array<{ label: string; minimumSpend: number }>
  bundle: TieInBundleRebate
}) {
  const [scenarios, setScenarios] = useState(() => [
    {
      name: "At minimums",
      spends: members.map((m) => m.minimumSpend),
    },
    {
      name: "20% over all",
      spends: members.map((m) => m.minimumSpend * 1.2),
    },
    {
      name: "50% over all (accelerator)",
      spends: members.map((m) => m.minimumSpend * 1.5),
    },
  ])

  const results = useMemo(
    () =>
      runTieInImpactAnalysis(
        members.map((m) => ({ minimumSpend: m.minimumSpend })),
        bundle,
        scenarios,
      ),
    [members, bundle, scenarios],
  )

  function updateSpend(si: number, mi: number, value: string) {
    const parsed = Number(value.replace(/[^0-9.]/g, "")) || 0
    setScenarios((prev) =>
      prev.map((s, i) =>
        i === si
          ? { ...s, spends: s.spends.map((v, j) => (j === mi ? parsed : v)) }
          : s,
      ),
    )
  }

  function addScenario() {
    setScenarios((p) => [
      ...p,
      { name: `Scenario ${p.length + 1}`, spends: members.map(() => 0) },
    ])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact analysis</CardTitle>
        <CardDescription>
          What-if allocations across the bundle&rsquo;s members. Edit any
          spend to see whether the scenario clears compliance or unlocks
          a bonus / accelerator tier.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-medium">Scenario</th>
                {members.map((m, i) => (
                  <th key={i} className="py-2 pr-3 text-left font-medium">
                    {m.label}
                    <div className="text-[10px] font-normal text-muted-foreground">
                      min {formatCurrency(m.minimumSpend)}
                    </div>
                  </th>
                ))}
                <th className="py-2 pr-3 text-right font-medium">Total spend</th>
                <th className="py-2 pr-3 text-right font-medium">Rebate</th>
                <th className="py-2 pr-3 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, si) => {
                const r = results[si]
                return (
                  <tr key={si} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.name}</td>
                    {s.spends.map((spend, mi) => (
                      <td key={mi} className="py-2 pr-3">
                        <Input
                          className="h-8 w-28 tabular-nums"
                          type="number"
                          value={spend}
                          onChange={(e) => updateSpend(si, mi, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(r?.totalSpend ?? 0)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">
                      {formatCurrency(r?.rebateEarned ?? 0)}
                      {r?.rebatePct ? (
                        <div className="text-[10px] text-muted-foreground">
                          {r.rebatePct.toFixed(2)}%
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-center">
                      {r?.compliant ? (
                        <Badge variant="outline" className="text-xs">
                          compliant
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">
                          short
                        </Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={addScenario}>
            + Add scenario
          </Button>
          <Label className="ml-3 text-xs text-muted-foreground">
            Base + bonus at ≥120% · accelerator at ≥150%.
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}

"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getContractTieInBundle } from "@/lib/actions/contracts/tie-in"

interface ContractTieInCardProps {
  contractId: string
}

export function ContractTieInCard({ contractId }: ContractTieInCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-tie-in-bundle", contractId],
    queryFn: () => getContractTieInBundle(contractId),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tie-In Bundle</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }

  // No bundle: don't render anything.
  if (!data?.bundle) {
    return null
  }

  const { bundle } = data
  const evaluation = bundle.evaluation as {
    complianceStatus: "compliant" | "non_compliant" | "partial"
    baseRebate: number
    totalRebate: number
    // either all-or-nothing fields
    bonusRebate?: number
    failingMembers?: string[]
    // or proportional fields
    weightedCompliancePercent?: number
  }

  const statusVariant: "default" | "secondary" | "destructive" =
    evaluation.complianceStatus === "compliant"
      ? "default"
      : evaluation.complianceStatus === "partial"
        ? "secondary"
        : "destructive"

  const statusLabel = evaluation.complianceStatus.replace("_", " ")

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Tie-In Bundle</CardTitle>
          <p className="text-xs text-muted-foreground pt-1">
            Mode: {bundle.complianceMode.replace(/_/g, " ")}
            {bundle.bonusMultiplier != null &&
              ` · Bonus multiplier ${Number(bundle.bonusMultiplier).toFixed(2)}×`}
          </p>
        </div>
        <Badge variant={statusVariant} className="capitalize shrink-0">
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Base Rebate</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatCurrency(Number(evaluation.baseRebate))}
            </div>
          </div>
          {"bonusRebate" in evaluation && evaluation.bonusRebate !== undefined && (
            <div>
              <div className="text-xs text-muted-foreground">Bonus</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCurrency(Number(evaluation.bonusRebate))}
              </div>
            </div>
          )}
          {"weightedCompliancePercent" in evaluation &&
            evaluation.weightedCompliancePercent !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Weighted Compliance</div>
                <div className="text-lg font-semibold tabular-nums">
                  {Number(evaluation.weightedCompliancePercent).toFixed(1)}%
                </div>
              </div>
            )}
          <div>
            <div className="text-xs text-muted-foreground">Total Rebate</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatCurrency(Number(evaluation.totalRebate))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase">
            Bundle Members
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Contract</th>
                <th className="py-2 text-right font-medium">Weight</th>
                <th className="py-2 text-right font-medium">Minimum</th>
                <th className="py-2 text-right font-medium">Spend</th>
                <th className="py-2 text-right font-medium">Rebate</th>
                <th className="py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bundle.members.map((m) => (
                <tr key={m.contractId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2">
                    <Link
                      href={`/dashboard/contracts/${m.contractId}`}
                      className="font-medium hover:underline"
                    >
                      {m.contractName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {m.vendorName}
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(m.weightPercent).toFixed(0)}%
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {m.minimumSpend != null ? formatCurrency(Number(m.minimumSpend)) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(Number(m.currentSpend))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(Number(m.currentRebate))}
                  </td>
                  <td className="py-2 text-center">
                    {m.compliantSoFar ? (
                      <Badge variant="default" className="text-xs">
                        met
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">
                        under
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

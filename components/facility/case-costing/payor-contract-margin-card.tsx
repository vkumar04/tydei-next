"use client"

/**
 * Payor Contract Margin card — /dashboard/case-costing.
 *
 * Renders a payor-contract picker and three stat tiles (Est.
 * Reimbursement / CPT Matched / Total Margin) with a summary card below.
 * The E2E `tests/workflows/facility-payor-contract-margin.spec.ts`
 * locks the card title + tile labels, so the copy here is canonical.
 */
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import {
  getPayorContractsForFacility,
  getPayorContractMarginSummary,
} from "@/lib/actions/case-costing/payor-margin"

export function PayorContractMarginCard() {
  const [selected, setSelected] = useState<string | undefined>(undefined)

  const contractsQuery = useQuery({
    queryKey: ["case-costing", "payor-contracts"] as const,
    queryFn: () => getPayorContractsForFacility(),
  })

  const summaryQuery = useQuery({
    queryKey: ["case-costing", "payor-margin", selected] as const,
    queryFn: () =>
      selected ? getPayorContractMarginSummary(selected) : null,
    enabled: !!selected,
  })

  const options = contractsQuery.data ?? []
  const summary = summaryQuery.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payor Contract Margin</CardTitle>
        <CardDescription>
          Pick a payor contract to estimate reimbursement, CPT coverage,
          and total margin across this facility&apos;s cases.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selected} onValueChange={(v) => setSelected(v)}>
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Select payor contract" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {summaryQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Est. Reimbursement"
                value={formatCurrency(summary.estReimbursement)}
              />
              <Stat
                label="CPT Matched"
                value={String(summary.cptMatched)}
                sub={`${summary.totalCases} cases total`}
              />
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Margin
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  {formatCurrency(summary.totalMargin)}
                </p>
                <p className="text-xs text-muted-foreground">
                  vs {formatCurrency(summary.totalSpend)} in case spend
                </p>
              </CardContent>
            </Card>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a payor contract to see margin.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

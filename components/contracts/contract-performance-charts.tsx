"use client"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, Label } from "recharts"
import { useQuery } from "@tanstack/react-query"
import { getContractPerformanceHistory } from "@/lib/actions/contracts/performance-history"

const formatAxisCurrency = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : `$${n}`

// Charles W1.W-C2: the recharts default Tooltip renders the raw
// dataKey (`spend`) and un-formatted number. Format as US currency and
// label the line so the hover bubble reads "Monthly spend on this
// contract: $123,456" instead of "spend: 123456".
const formatTooltipCurrency = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })

export function ContractPerformanceCharts({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "perf-history", contractId] as const,
    queryFn: () => getContractPerformanceHistory(contractId),
  })
  if (isLoading || !data) return <div className="h-72 animate-pulse rounded-md bg-muted" />
  // Charles W1.W-C2: expose the peak month so the chart tooltip can
  // annotate the highest-spend month when the user hovers it.
  const peakMonth = data.monthly.reduce(
    (peak, row) => (row.spend > peak.spend ? row : peak),
    { month: "", spend: 0 },
  )
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Monthly Spend</CardTitle>
          {/*
           * Charles W1.W-C2: subtitle clarifies SCOPE (this contract
           * only) and RANGE (last N months). Without it the chart reads
           * like a facility-wide total, which under-reported the user's
           * understanding of this contract's footprint.
           */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Monthly spend on this contract (last {data.monthly.length}{" "}
            {data.monthly.length === 1 ? "month" : "months"}). Axis is USD.
          </p>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthly} margin={{ left: 8, right: 8, top: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month">
                <Label value="Month" position="insideBottom" offset={-12} style={{ fill: "#6b7280", fontSize: 11 }} />
              </XAxis>
              <YAxis width={80} tickFormatter={formatAxisCurrency}>
                <Label value="Spend (USD)" angle={-90} position="insideLeft" style={{ fill: "#6b7280", fontSize: 11, textAnchor: "middle" }} />
              </YAxis>
              <Tooltip
                formatter={(value) => [
                  formatTooltipCurrency(Number(value) || 0),
                  "Spend (this contract only)",
                ]}
                labelFormatter={(label) => {
                  const s = typeof label === "string" ? label : String(label ?? "")
                  return s === peakMonth.month
                    ? `${s} — peak month in view`
                    : s
                }}
              />
              <Area type="monotone" dataKey="spend" name="Spend" stroke="#10b981" fill="#10b98133" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Rebate by Quarter</CardTitle></CardHeader>
        <CardContent className="h-72">
          {data.quarterly.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              No rebate data yet for this contract. Earned rebates appear
              once a pay period closes; collected rebates appear once a
              collection date is recorded.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.quarterly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="quarter" />
                <YAxis width={80} tickFormatter={formatAxisCurrency} />
                <Tooltip />
                <Legend />
                <Bar dataKey="rebateEarned" fill="#3b82f6" name="Earned" />
                <Bar dataKey="rebateCollected" fill="#10b981" name="Collected" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

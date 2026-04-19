"use client"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts"
import { useQuery } from "@tanstack/react-query"
import { getContractPerformanceHistory } from "@/lib/actions/contracts/performance-history"

const formatAxisCurrency = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : `$${n}`

export function ContractPerformanceCharts({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "perf-history", contractId] as const,
    queryFn: () => getContractPerformanceHistory(contractId),
  })
  if (isLoading || !data) return <div className="h-72 animate-pulse rounded-md bg-muted" />
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Monthly Spend</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthly} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis width={80} tickFormatter={formatAxisCurrency} />
              <Tooltip />
              <Area type="monotone" dataKey="spend" stroke="#10b981" fill="#10b98133" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Rebate by Quarter</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.quarterly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="quarter" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="rebateEarned" fill="#3b82f6" name="Earned" />
              <Bar dataKey="rebateCollected" fill="#10b981" name="Collected" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

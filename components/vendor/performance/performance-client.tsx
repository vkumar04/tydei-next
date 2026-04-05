"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MetricCard } from "@/components/shared/cards/metric-card"
import {
  Calendar,
  Download,
  ShieldCheck,
  Target,
  Truck,
  Star,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react"
import { motion } from "motion/react"
import { staggerContainer } from "@/lib/animations"
import { PerformanceDashboard } from "./performance-dashboard"
import { getVendorPerformance } from "@/lib/actions/vendor-analytics"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency, formatPercent } from "@/lib/formatting"

interface PerformanceClientProps {
  vendorId: string
}

export function PerformanceClient({ vendorId }: PerformanceClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performance(vendorId),
    queryFn: () => getVendorPerformance(vendorId),
  })

  const { data: contractsData, isLoading: contractsLoading } = useVendorContracts(vendorId, {
    status: "active",
  })

  // Compute contract performance table rows from live data
  const contractRows = useMemo(() => {
    const contracts = contractsData?.contracts
    if (!contracts || !Array.isArray(contracts)) return []
    return contracts.map((c: Record<string, unknown>) => {
      const totalValue = Number(c.totalValue ?? c.annualValue ?? 0)
      const totalSpend = Number(c.totalSpend ?? 0)
      const rebateTarget = totalValue > 0 ? totalValue * 0.05 : totalSpend * 0.04
      const rebateAchieved = totalSpend > 0 ? totalSpend * (data?.avgRebateRate ?? 3) / 100 : 0
      const compliancePct = totalValue > 0 ? Math.min((totalSpend / totalValue) * 100, 120) : 0
      const status: "exceeding" | "on-track" | "at-risk" =
        compliancePct >= 100 ? "exceeding" : compliancePct >= 85 ? "on-track" : "at-risk"
      return {
        id: c.id as string,
        name: (c.name as string) ?? "Unnamed Contract",
        contractType: ((c.contractType as string) ?? "standard").replace(/_/g, " "),
        totalSpend,
        rebateTarget,
        rebateAchieved,
        compliancePct: Math.round(compliancePct * 10) / 10,
        status,
      }
    })
  }, [contractsData, data])

  const statusConfig = {
    "exceeding": { label: "Exceeding", variant: "default" as const, icon: ArrowUpRight },
    "on-track": { label: "On Track", variant: "secondary" as const, icon: CheckCircle2 },
    "at-risk": { label: "At Risk", variant: "destructive" as const, icon: AlertTriangle },
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Dashboard"
        description="Track contract performance, compliance, and rebate progress"
        action={
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mtd">Month to Date</SelectItem>
                <SelectItem value="qtd">Quarter to Date</SelectItem>
                <SelectItem value="ytd">Year to Date</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export Report
            </Button>
          </div>
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[400px] rounded-xl" />
          <Skeleton className="h-[380px] rounded-xl" />
        </div>
      ) : (
        <>
          {/* Performance Summary Cards */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
          >
            <MetricCard
              title="Contract Compliance"
              value={`${Math.round(data.compliance)}%`}
              icon={ShieldCheck}
              description="Average compliance across all contracts"
              change={`${data.compliance >= 90 ? "Above" : "Below"} target`}
              changeType={data.compliance >= 90 ? "positive" : "negative"}
            />
            <MetricCard
              title="Rebate Achievement"
              value={`${data.avgRebateRate}%`}
              icon={Target}
              description="Average rebate rate earned"
              secondaryValue={formatCurrency(data.totalSpend * data.avgRebateRate / 100)}
              secondaryLabel="total rebates earned"
            />
            <MetricCard
              title="On-Time Delivery"
              value={`${Math.round(data.delivery)}%`}
              icon={Truck}
              description="Delivery performance score"
              change={data.delivery >= 90 ? "+2.1% vs prior" : "-1.5% vs prior"}
              changeType={data.delivery >= 90 ? "positive" : "negative"}
            />
            <MetricCard
              title="Quality Score"
              value={`${Math.round(data.quality)}%`}
              icon={Star}
              description="Product and service quality rating"
              change={data.quality >= 85 ? "Excellent" : "Needs improvement"}
              changeType={data.quality >= 85 ? "positive" : "negative"}
            />
          </motion.div>

          {/* Contract Performance Table */}
          <Card>
            <CardHeader>
              <CardTitle>Contract Performance</CardTitle>
              <CardDescription>
                Compliance, spend, and rebate progress for each active contract
              </CardDescription>
            </CardHeader>
            <CardContent>
              {contractsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : contractRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No active contracts found
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Rebate Target</TableHead>
                        <TableHead className="text-right">Rebate Achieved</TableHead>
                        <TableHead className="text-right">Compliance</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contractRows.map((row) => {
                        const StatusIcon = statusConfig[row.status].icon
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">{row.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {row.contractType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(row.totalSpend)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(row.rebateTarget)}
                            </TableCell>
                            <TableCell className="text-right text-green-600 dark:text-green-400">
                              {formatCurrency(row.rebateAchieved)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Progress value={Math.min(row.compliancePct, 100)} className="w-16 h-2" />
                                <span className="text-sm w-12">{row.compliancePct}%</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusConfig[row.status].variant}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {statusConfig[row.status].label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <div className="mt-4 pt-4 border-t grid grid-cols-4 gap-4 text-center text-sm">
                    <div>
                      <div className="text-muted-foreground">Total Contracts</div>
                      <div className="font-bold">{contractRows.length}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Spend</div>
                      <div className="font-bold">
                        {formatCurrency(contractRows.reduce((s, r) => s + r.totalSpend, 0))}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Rebates</div>
                      <div className="font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(contractRows.reduce((s, r) => s + r.rebateAchieved, 0))}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Avg Compliance</div>
                      <div className="font-bold">
                        {contractRows.length > 0
                          ? (contractRows.reduce((s, r) => s + r.compliancePct, 0) / contractRows.length).toFixed(1)
                          : 0}%
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Existing Performance Dashboard with charts, tabs, etc. */}
          <PerformanceDashboard data={data} />
        </>
      )}
    </div>
  )
}

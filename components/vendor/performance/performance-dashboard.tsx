"use client"

import { useState, useMemo } from "react"
import {
  FileText,
  Building2,
  Percent,
  DollarSign,
  Target,
  Calendar,
  Download,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { PerformanceRadar } from "./performance-radar"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { VendorPerformanceData } from "@/lib/actions/vendor-analytics"

// No hardcoded data — all values come from `data` prop

interface PerformanceDashboardProps {
  data: VendorPerformanceData
}

export function PerformanceDashboard({ data }: PerformanceDashboardProps) {
  const totalActualSpend = data.totalSpend
  const totalRebatesPaid = totalActualSpend * (data.avgRebateRate / 100)

  return (
    <div className="space-y-6">
      {/* Tabs - Overview with radar + rebate summary */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rebates">Rebate Progress</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Performance Radar */}
            <PerformanceRadar
              scores={{
                compliance: data.compliance,
                delivery: data.delivery,
                quality: data.quality,
                pricing: data.pricing,
              }}
            />

            {/* Rebate Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rebate Summary</CardTitle>
                <CardDescription>Year-to-date rebate performance</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {formatCurrency(totalRebatesPaid)}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Paid YTD</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold">
                      {totalActualSpend > 0 ? `${data.avgRebateRate}%` : "0%"}
                    </div>
                    <div className="text-sm text-muted-foreground">Effective Rate</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold">{data.contractCount}</div>
                    <div className="text-sm text-muted-foreground">Active Contracts</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold">{data.activeFacilities}</div>
                    <div className="text-sm text-muted-foreground">Active Facilities</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Rebate Progress Tab */}
        <TabsContent value="rebates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rebate Performance</CardTitle>
              <CardDescription>Spend and rebate data from your contracts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="rounded-lg border p-4">
                  <div className="text-2xl font-bold">{formatCurrency(totalActualSpend)}</div>
                  <div className="text-sm text-muted-foreground">Total Spend</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(totalRebatesPaid)}
                  </div>
                  <div className="text-sm text-muted-foreground">Rebates Earned</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-2xl font-bold">{data.avgRebateRate}%</div>
                  <div className="text-sm text-muted-foreground">Avg Rebate Rate</div>
                </div>
              </div>
              {data.contractCount === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No active contracts found. Performance data will appear once contracts are active.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

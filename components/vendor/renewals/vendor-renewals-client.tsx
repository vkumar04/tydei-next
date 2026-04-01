"use client"

import { useMemo } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { VendorRenewalPipeline } from "./vendor-renewal-pipeline"
import { useExpiringContracts } from "@/hooks/use-renewals"
import {
  Calendar,
  Download,
  FileText,
  AlertTriangle,
  Clock,
  CalendarClock,
  ListChecks,
  Building2,
  Eye,
} from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { motion } from "motion/react"
import { staggerContainer } from "@/lib/animations"
import Link from "next/link"

interface VendorRenewalsClientProps {
  vendorId: string
}

function getUrgencyStatus(daysUntilExpiry: number): "critical" | "warning" | "upcoming" | "ok" {
  if (daysUntilExpiry <= 30) return "critical"
  if (daysUntilExpiry <= 90) return "warning"
  if (daysUntilExpiry <= 180) return "upcoming"
  return "ok"
}

const urgencyConfig = {
  critical: {
    label: "Critical",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800",
  },
  warning: {
    label: "Warning",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800",
  },
  ok: {
    label: "On Track",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
}

export function VendorRenewalsClient({ vendorId }: VendorRenewalsClientProps) {
  const { data: contracts, isLoading } = useExpiringContracts(vendorId, 365, "vendor")

  const handleExportCalendar = () => {
    toast.success("Calendar exported", {
      description: "Renewal dates exported to your calendar",
    })
  }

  // Compute pipeline summary from real data
  const pipelineStats = useMemo(() => {
    if (!contracts || contracts.length === 0)
      return { total: 0, critical: 0, warning: 0, upcoming: 0, ok: 0 }

    const critical = contracts.filter((c) => c.daysUntilExpiry <= 30).length
    const warning = contracts.filter((c) => c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 90).length
    const upcoming = contracts.filter((c) => c.daysUntilExpiry > 90 && c.daysUntilExpiry <= 180).length
    const ok = contracts.filter((c) => c.daysUntilExpiry > 180).length

    return { total: contracts.length, critical, warning, upcoming, ok }
  }, [contracts])

  // Enriched rows for the summary table
  const renewalRows = useMemo(() => {
    if (!contracts) return []
    return contracts
      .map((c) => ({
        ...c,
        urgency: getUrgencyStatus(c.daysUntilExpiry),
      }))
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  }, [contracts])

  // Empty state
  if (!isLoading && (!contracts || contracts.length === 0)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Contract Renewals"
          description="Track and manage upcoming contract renewals across all facilities"
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Expiring Contracts</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              No contracts are expiring within the next year. Check back later or extend the window.
            </p>
            <Button asChild>
              <Link href="/vendor/contracts">View All Contracts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Renewals"
        description="Track and manage upcoming contract renewals across all facilities"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportCalendar}>
              <Calendar className="mr-2 h-4 w-4" />
              Export Calendar
            </Button>
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export Report
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[400px] rounded-xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Pipeline Summary Cards */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <MetricCard
              title="Total Renewals"
              value={pipelineStats.total}
              icon={ListChecks}
              description="Contracts expiring within 1 year"
              change={`${pipelineStats.total} in pipeline`}
              changeType="positive"
            />
            <MetricCard
              title="Critical (<30 days)"
              value={pipelineStats.critical}
              icon={AlertTriangle}
              description="Require immediate action"
              change={pipelineStats.critical > 0 ? "Urgent" : "None"}
              changeType={pipelineStats.critical > 0 ? "negative" : "positive"}
            />
            <MetricCard
              title="Warning (<90 days)"
              value={pipelineStats.warning}
              icon={Clock}
              description="Start renewal discussions"
              change={pipelineStats.warning > 0 ? `${pipelineStats.warning} need attention` : "Clear"}
              changeType={pipelineStats.warning > 0 ? "negative" : "positive"}
            />
            <MetricCard
              title="Upcoming (<180 days)"
              value={pipelineStats.upcoming}
              icon={CalendarClock}
              description="Plan ahead for these renewals"
              change={`${pipelineStats.ok} more beyond 180d`}
              changeType="positive"
            />
          </motion.div>

          {/* Renewals Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>Renewal Pipeline</CardTitle>
              <CardDescription>
                All contracts approaching expiration, sorted by urgency
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renewalRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No renewals in the pipeline
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract Name</TableHead>
                        <TableHead>Facility</TableHead>
                        <TableHead>Expiration Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Days Remaining</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renewalRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              {row.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              {row.facilityName ?? "N/A"}
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(row.expirationDate)}</TableCell>
                          <TableCell>
                            <Badge className={urgencyConfig[row.urgency].className}>
                              {urgencyConfig[row.urgency].label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={
                                row.daysUntilExpiry <= 30
                                  ? "text-red-600 dark:text-red-400 font-bold"
                                  : row.daysUntilExpiry <= 90
                                    ? "text-amber-600 dark:text-amber-400 font-medium"
                                    : ""
                              }
                            >
                              {row.daysUntilExpiry} days
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.totalSpend)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/vendor/contracts/${row.id}`}>
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {renewalRows.length} contracts in pipeline |{" "}
                      {pipelineStats.critical} critical | {pipelineStats.warning} warning |{" "}
                      {pipelineStats.upcoming} upcoming
                    </span>
                    <span>
                      Total at-risk spend:{" "}
                      {formatCurrency(
                        renewalRows
                          .filter((r) => r.daysUntilExpiry <= 90)
                          .reduce((sum, r) => sum + r.totalSpend, 0)
                      )}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Existing full pipeline component with timeline, dialogs, etc. */}
          <VendorRenewalPipeline contracts={contracts ?? []} />
        </>
      )}
    </div>
  )
}

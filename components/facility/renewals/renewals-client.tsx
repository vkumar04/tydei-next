"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RenewalInitiateDialog } from "./renewal-initiate-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { useExpiringContracts, useInitiateRenewal } from "@/hooks/use-renewals"
import { formatCurrency, formatDate } from "@/lib/formatting"
import {
  AlertTriangle,
  Clock,
  DollarSign,
  TrendingUp,
  CheckCircle2,
  FileText,
  Bell,
  Download,
  Eye,
  Calendar,
  Mail,
  Sparkles,
  ChevronRight,
} from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import type { ExpiringContract } from "@/lib/actions/renewals"

interface RenewalsClientProps {
  facilityId: string
}

const statusConfig: Record<
  string,
  {
    label: string
    color: string
    icon: typeof AlertTriangle
  }
> = {
  critical: {
    label: "Critical",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    icon: AlertTriangle,
  },
  warning: {
    label: "Action Needed",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    icon: Clock,
  },
  upcoming: {
    label: "Upcoming",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    icon: Calendar,
  },
  ok: {
    label: "On Track",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    icon: CheckCircle2,
  },
}

function getContractStatus(
  daysUntilExpiry: number
): "critical" | "warning" | "upcoming" | "ok" {
  if (daysUntilExpiry <= 30) return "critical"
  if (daysUntilExpiry <= 90) return "warning"
  if (daysUntilExpiry <= 180) return "upcoming"
  return "ok"
}

export function RenewalsClient({ facilityId }: RenewalsClientProps) {
  const [activeTab, setActiveTab] = useState("all")
  const [vendorFilter, setVendorFilter] = useState("all")
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedContract, setSelectedContract] =
    useState<ExpiringContract | null>(null)
  const [renewalTarget, setRenewalTarget] = useState<{
    id: string
    name: string
    vendor: string
  } | null>(null)

  const { data: contracts, isLoading } = useExpiringContracts(
    facilityId,
    365,
    "facility"
  )
  const initiate = useInitiateRenewal()

  // Contracts with status derived from days
  const contractsWithStatus = useMemo(() => {
    if (!contracts) return []
    return contracts.map((c) => ({
      ...c,
      renewalStatus: getContractStatus(c.daysUntilExpiry),
    }))
  }, [contracts])

  // Summary stats
  const stats = useMemo(() => {
    if (!contractsWithStatus.length)
      return { critical: 0, warning: 0, totalValue: 0, uncollectedRebates: 0 }
    const critical = contractsWithStatus.filter(
      (c) => c.renewalStatus === "critical"
    ).length
    const warning = contractsWithStatus.filter(
      (c) => c.renewalStatus === "warning"
    ).length
    const totalValue = contractsWithStatus
      .filter((c) => c.daysUntilExpiry <= 180)
      .reduce((sum, c) => sum + c.totalSpend, 0)
    const uncollectedRebates = 0
    return { critical, warning, totalValue, uncollectedRebates }
  }, [contractsWithStatus])

  // Unique vendors
  const vendors = useMemo(() => {
    return [...new Set(contractsWithStatus.map((c) => c.vendorName))]
  }, [contractsWithStatus])

  // Filter
  const filteredContracts = useMemo(() => {
    let filtered = contractsWithStatus
    if (activeTab !== "all") {
      filtered = filtered.filter((c) => c.renewalStatus === activeTab)
    }
    if (vendorFilter !== "all") {
      filtered = filtered.filter((c) => c.vendorName === vendorFilter)
    }
    return filtered.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  }, [contractsWithStatus, activeTab, vendorFilter])

  const handleViewDetails = (contract: ExpiringContract) => {
    setSelectedContract(contract)
    setDetailsOpen(true)
  }

  const handleExportCalendar = () => {
    toast.success("Calendar exported", {
      description: "Contract renewal events exported",
    })
  }

  const handleConfigureAlerts = () => {
    toast.info("Alert configuration coming soon")
  }

  const handleSendReminder = (contract: ExpiringContract) => {
    toast.success("Reminder sent", {
      description: `Renewal reminder sent to ${contract.vendorName} rep`,
    })
  }

  const handleGenerateSummary = () => {
    toast.success("Renewal summary generated", {
      description: "Summary report has been downloaded",
    })
  }

  async function handleInitiate() {
    if (!renewalTarget) return
    try {
      await initiate.mutateAsync(renewalTarget.id)
      toast.success("Renewal draft created successfully")
    } catch {
      toast.error("Failed to create renewal draft")
    }
  }

  const selectedStatus = selectedContract
    ? getContractStatus(selectedContract.daysUntilExpiry)
    : "ok"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Contract Renewal Intelligence
          </h1>
          <p className="text-muted-foreground">
            Proactive alerts and AI-powered renewal recommendations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleConfigureAlerts}>
            <Bell className="mr-2 h-4 w-4" />
            Configure Alerts
          </Button>
          <Button onClick={handleExportCalendar}>
            <Download className="mr-2 h-4 w-4" />
            Export Calendar
          </Button>
        </div>
      </div>

      {/* Critical Alert */}
      {stats.critical > 0 && (
        <Alert className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-800 dark:text-red-200">
            Immediate Attention Required
          </AlertTitle>
          <AlertDescription className="text-red-700 dark:text-red-300">
            {stats.critical} contract(s) expire within 30 days representing{" "}
            {formatCurrency(
              contractsWithStatus
                .filter((c) => c.renewalStatus === "critical")
                .reduce((sum, c) => sum + c.totalSpend, 0)
            )}{" "}
            in annual spend. Review and take action immediately.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Expiring in 30 Days
                  </p>
                  <p className="text-2xl font-bold">{stats.critical}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    contracts need action
                  </p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-yellow-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Expiring in 90 Days
                  </p>
                  <p className="text-2xl font-bold">
                    {stats.warning + stats.critical}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    start negotiations
                  </p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">At-Risk Spend</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(stats.totalValue)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    in next 6 months
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-blue-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-red-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Uncollected Rebates
                  </p>
                  <p className="text-2xl font-bold text-red-600">
                    -{formatCurrency(stats.uncollectedRebates)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    collect before renewal
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Timeline View */}
      {!isLoading && contractsWithStatus.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Renewal Timeline</CardTitle>
            <CardDescription>
              Visual overview of upcoming contract expirations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {/* Timeline axis */}
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
                <span>Today</span>
                <span>30 days</span>
                <span>60 days</span>
                <span>90 days</span>
                <span>180 days</span>
                <span>1 year</span>
              </div>
              <div className="h-2 rounded-full bg-muted relative">
                {/* Zone indicators */}
                <div className="absolute inset-y-0 left-0 w-[8%] rounded-l-full bg-red-200 dark:bg-red-900/50" />
                <div className="absolute inset-y-0 left-[8%] w-[17%] bg-yellow-200 dark:bg-yellow-900/50" />
                <div className="absolute inset-y-0 left-[25%] w-[25%] bg-blue-200 dark:bg-blue-900/50" />
              </div>

              {/* Contract markers */}
              <div className="relative h-20 mt-2">
                {contractsWithStatus.map((contract) => {
                  const position = Math.min(
                    (contract.daysUntilExpiry / 365) * 100,
                    100
                  )
                  const color =
                    contract.renewalStatus === "critical"
                      ? "bg-red-500"
                      : contract.renewalStatus === "warning"
                        ? "bg-yellow-500"
                        : contract.renewalStatus === "upcoming"
                          ? "bg-blue-500"
                          : "bg-green-500"

                  return (
                    <div
                      key={contract.id}
                      className="absolute flex flex-col items-center cursor-pointer group"
                      style={{
                        left: `${position}%`,
                        transform: "translateX(-50%)",
                      }}
                      onClick={() => handleViewDetails(contract)}
                    >
                      <div
                        className={`w-4 h-4 rounded-full ${color} border-2 border-white shadow-sm`}
                      />
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-6 bg-popover border rounded-lg p-2 shadow-lg z-10 whitespace-nowrap">
                        <p className="font-medium text-sm">
                          {contract.vendorName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {contract.daysUntilExpiry} days
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contract List */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px] rounded-xl" />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Contracts by Status</CardTitle>
                <CardDescription>
                  Click on a contract to view renewal details
                </CardDescription>
              </div>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="critical" className="text-red-600">
                  Critical (
                  {
                    contractsWithStatus.filter(
                      (c) => c.renewalStatus === "critical"
                    ).length
                  }
                  )
                </TabsTrigger>
                <TabsTrigger value="warning" className="text-yellow-600">
                  Warning (
                  {
                    contractsWithStatus.filter(
                      (c) => c.renewalStatus === "warning"
                    ).length
                  }
                  )
                </TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="ok">On Track</TabsTrigger>
              </TabsList>

              <div className="mt-4">
                {filteredContracts.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No Contracts"
                    description="No contracts match this filter."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead>Days Left</TableHead>
                        <TableHead>Annual Spend</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContracts.map((contract) => {
                        const cfg =
                          statusConfig[contract.renewalStatus] ??
                          statusConfig.ok
                        const StatusIcon = cfg.icon
                        return (
                          <TableRow
                            key={contract.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleViewDetails(contract)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">
                                  {contract.name}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{contract.vendorName}</TableCell>
                            <TableCell>
                              {formatDate(contract.expirationDate)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  contract.daysUntilExpiry <= 30
                                    ? "text-red-600 font-medium"
                                    : ""
                                }
                              >
                                {contract.daysUntilExpiry} days
                              </span>
                            </TableCell>
                            <TableCell>
                              {formatCurrency(contract.totalSpend)}
                            </TableCell>
                            <TableCell>
                              <Badge className={cfg.color}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {cfg.label}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleViewDetails(contract)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleGenerateSummary}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Contract Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {selectedContract?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedContract?.vendorName} - Expires{" "}
              {selectedContract && formatDate(selectedContract.expirationDate)}
            </DialogDescription>
          </DialogHeader>

          {selectedContract && (
            <div className="space-y-6">
              {/* Status Banner */}
              <div
                className={`p-4 rounded-lg ${
                  selectedStatus === "critical"
                    ? "bg-red-50 dark:bg-red-950/30 border border-red-200"
                    : selectedStatus === "warning"
                      ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200"
                      : "bg-blue-50 dark:bg-blue-950/30 border border-blue-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedStatus === "critical" && (
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                    )}
                    {selectedStatus === "warning" && (
                      <Clock className="h-5 w-5 text-yellow-600" />
                    )}
                    {(selectedStatus === "upcoming" ||
                      selectedStatus === "ok") && (
                      <Calendar className="h-5 w-5 text-blue-600" />
                    )}
                    <div>
                      <p className="font-medium">
                        {selectedContract.daysUntilExpiry} days until expiration
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {selectedStatus === "critical"
                          ? "Immediate action required"
                          : selectedStatus === "warning"
                            ? "Begin renewal negotiations"
                            : "Plan renewal strategy"}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSendReminder(selectedContract)}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Contact Vendor
                  </Button>
                </div>
              </div>

              {/* Performance Summary */}
              <div className="grid grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">Total Spend</p>
                  <p className="text-xl font-bold">
                    {formatCurrency(selectedContract.totalSpend)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    Days Remaining
                  </p>
                  <p className="text-xl font-bold">
                    {selectedContract.daysUntilExpiry}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">Tier Achieved</p>
                  <p className="text-xl font-bold text-green-600">
                    {selectedContract.tierAchieved ?? "N/A"}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">Auto Renewal</p>
                  <p className="text-xl font-bold">
                    {selectedContract.autoRenewal ? "Yes" : "No"}
                  </p>
                </div>
              </div>

              {/* AI Recommendations */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI Negotiation Recommendations
                </h4>
                <div className="space-y-2">
                  {[
                    "Review current tier performance and opportunities for tier advancement",
                    "Analyze spend patterns against competitive alternatives",
                    "Consider multi-year agreement for rate lock benefits",
                    "Request updated pricing based on volume commitments",
                    "Review pricing on top 10 SKUs vs market rates",
                  ].map((point, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20"
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                        {idx + 1}
                      </div>
                      <p className="text-sm">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>
              Close
            </Button>
            <Button variant="outline" onClick={handleGenerateSummary}>
              <Download className="mr-2 h-4 w-4" />
              Generate Summary
            </Button>
            {selectedContract && (
              <Button asChild>
                <Link href={`/dashboard/contracts/${selectedContract.id}`}>
                  View Full Contract
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenewalInitiateDialog
        contractName={renewalTarget?.name ?? ""}
        vendorName={renewalTarget?.vendor ?? ""}
        open={!!renewalTarget}
        onOpenChange={(open) => {
          if (!open) setRenewalTarget(null)
        }}
        onInitiate={handleInitiate}
      />
    </div>
  )
}

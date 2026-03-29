"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Clock,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  DollarSign,
  TrendingUp,
  FileText,
  Eye,
  Mail,
  Send,
  Users,
  Sparkles,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { toast } from "sonner"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { useInitiateRenewal } from "@/hooks/use-renewals"
import type { ExpiringContract } from "@/lib/actions/renewals"

const statusConfig = {
  critical: { label: "Urgent", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300", icon: AlertTriangle },
  warning: { label: "Action Needed", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300", icon: Clock },
  upcoming: { label: "Upcoming", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300", icon: Calendar },
  ok: { label: "On Track", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300", icon: CheckCircle2 },
}

function getStatus(daysUntilExpiry: number): "critical" | "warning" | "upcoming" | "ok" {
  if (daysUntilExpiry <= 30) return "critical"
  if (daysUntilExpiry <= 60) return "warning"
  if (daysUntilExpiry <= 120) return "upcoming"
  return "ok"
}

interface VendorRenewalPipelineProps {
  contracts: ExpiringContract[]
}

export function VendorRenewalPipeline({ contracts }: VendorRenewalPipelineProps) {
  const [activeTab, setActiveTab] = useState("all")
  const [selectedRenewal, setSelectedRenewal] = useState<ExpiringContract | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [proposeTermsOpen, setProposeTermsOpen] = useState(false)
  const [proposalNotes, setProposalNotes] = useState("")

  const initiateRenewal = useInitiateRenewal()

  // Enrich with status
  const renewals = useMemo(() =>
    contracts.map((c) => ({
      ...c,
      status: getStatus(c.daysUntilExpiry),
    })).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    [contracts]
  )

  // Filter
  const filteredRenewals = useMemo(() => {
    if (activeTab === "all") return renewals
    return renewals.filter((r) => r.status === activeTab)
  }, [renewals, activeTab])

  // Summary stats
  const stats = useMemo(() => {
    const critical = renewals.filter((r) => r.status === "critical").length
    const warning = renewals.filter((r) => r.status === "warning").length
    const totalAtRisk = renewals
      .filter((r) => r.daysUntilExpiry <= 90)
      .reduce((sum, r) => sum + r.totalSpend, 0)
    const totalRebate = renewals.reduce((sum, r) => sum + r.totalRebate, 0)
    const facilitiesCount = new Set(renewals.map((r) => r.facilityId).filter(Boolean)).size
    return { critical, warning, totalAtRisk, totalRebate, facilitiesCount }
  }, [renewals])

  const handleViewDetails = (renewal: ExpiringContract & { status: string }) => {
    setSelectedRenewal(renewal)
    setDetailsOpen(true)
  }

  const handleContactFacility = (renewal: ExpiringContract) => {
    toast.success("Email drafted", {
      description: `Opening email to ${renewal.facilityName ?? "facility"} procurement`,
    })
  }

  const handleProposeTerms = () => {
    if (!selectedRenewal) return
    initiateRenewal.mutate(selectedRenewal.id, {
      onSuccess: () => {
        toast.success("Renewal initiated", {
          description: `Renewal created for ${selectedRenewal.name}`,
        })
        setProposeTermsOpen(false)
        setProposalNotes("")
      },
      onError: (e) => {
        toast.error("Failed to initiate renewal", { description: e.message })
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Critical Alert */}
      {stats.critical > 0 && (
        <Alert className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-800 dark:text-red-200">Urgent: Contracts Expiring Soon</AlertTitle>
          <AlertDescription className="text-red-700 dark:text-red-300">
            {stats.critical} contract(s) expire within 30 days representing{" "}
            {formatCurrency(
              renewals.filter((r) => r.status === "critical").reduce((sum, r) => sum + r.totalSpend, 0)
            )}{" "}
            in annual revenue. Contact these facilities immediately to discuss renewal.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Expiring in 30 Days</p>
                <p className="text-2xl font-bold">{stats.critical}</p>
                <p className="text-xs text-muted-foreground mt-1">urgent action needed</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Expiring in 60 Days</p>
                <p className="text-2xl font-bold">{stats.warning + stats.critical}</p>
                <p className="text-xs text-muted-foreground mt-1">start discussions</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">At-Risk Revenue</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.totalAtRisk)}</p>
                <p className="text-xs text-muted-foreground mt-1">in next 90 days</p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rebates Earned</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.totalRebate)}</p>
                <p className="text-xs text-muted-foreground mt-1">across all contracts</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Facilities</p>
                <p className="text-2xl font-bold">{stats.facilitiesCount}</p>
                <p className="text-xs text-muted-foreground mt-1">with renewals</p>
              </div>
              <Building2 className="h-8 w-8 text-purple-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Timeline View */}
      <Card>
        <CardHeader>
          <CardTitle>Renewal Timeline</CardTitle>
          <CardDescription>Visual overview of upcoming contract expirations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
              <span>Today</span>
              <span>30 days</span>
              <span>60 days</span>
              <span>90 days</span>
              <span>120 days</span>
            </div>
            <div className="h-2 rounded-full bg-muted relative">
              <div className="absolute inset-y-0 left-0 w-[25%] rounded-l-full bg-red-200 dark:bg-red-900/50" />
              <div className="absolute inset-y-0 left-[25%] w-[25%] bg-yellow-200 dark:bg-yellow-900/50" />
              <div className="absolute inset-y-0 left-[50%] w-[25%] bg-blue-200 dark:bg-blue-900/50" />
            </div>

            {/* Contract markers */}
            <div className="relative h-16 mt-2">
              {renewals.map((renewal) => {
                const maxDays = 120
                const position = Math.min((renewal.daysUntilExpiry / maxDays) * 100, 100)
                const color =
                  renewal.status === "critical" ? "bg-red-500" :
                  renewal.status === "warning" ? "bg-yellow-500" :
                  renewal.status === "upcoming" ? "bg-blue-500" : "bg-green-500"

                return (
                  <div
                    key={renewal.id}
                    className="absolute flex flex-col items-center cursor-pointer group"
                    style={{ left: `${position}%`, transform: "translateX(-50%)" }}
                    onClick={() => handleViewDetails(renewal)}
                  >
                    <div className={`w-4 h-4 rounded-full ${color} border-2 border-white shadow-sm`} />
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-6 bg-popover border rounded-lg p-2 shadow-lg z-10 whitespace-nowrap">
                      <p className="font-medium text-sm">{renewal.facilityName ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{renewal.name}</p>
                      <p className="text-xs text-muted-foreground">{renewal.daysUntilExpiry} days</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Renewals Table */}
      <Card>
        <CardHeader>
          <CardTitle>Renewals by Facility</CardTitle>
          <CardDescription>Click on a renewal to view details and propose terms</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="critical" className="text-red-600">
                Urgent ({renewals.filter((r) => r.status === "critical").length})
              </TabsTrigger>
              <TabsTrigger value="warning" className="text-yellow-600">
                Action Needed ({renewals.filter((r) => r.status === "warning").length})
              </TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="ok">On Track</TabsTrigger>
            </TabsList>

            <div className="mt-4">
              {filteredRenewals.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No contracts in this stage
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Facility</TableHead>
                      <TableHead>Contract</TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead>Days Left</TableHead>
                      <TableHead>Total Spend</TableHead>
                      <TableHead>Rebate Earned</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRenewals.map((renewal) => {
                      const StatusIcon = statusConfig[renewal.status].icon
                      return (
                        <TableRow
                          key={renewal.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleViewDetails(renewal)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{renewal.facilityName ?? "N/A"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span>{renewal.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(renewal.expirationDate)}</TableCell>
                          <TableCell>
                            <span className={renewal.daysUntilExpiry <= 30 ? "text-red-600 font-medium" : ""}>
                              {renewal.daysUntilExpiry} days
                            </span>
                          </TableCell>
                          <TableCell>{formatCurrency(renewal.totalSpend)}</TableCell>
                          <TableCell className="text-green-600">{formatCurrency(renewal.totalRebate)}</TableCell>
                          <TableCell>
                            <Badge className={statusConfig[renewal.status].color}>
                              <StatusIcon className="mr-1 h-3 w-3" />
                              {statusConfig[renewal.status].label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="sm" onClick={() => handleContactFacility(renewal)}>
                                <Mail className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleViewDetails(renewal)}>
                                <Eye className="h-4 w-4" />
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

      {/* Renewal Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedRenewal && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle className="flex items-center gap-2">
                      {selectedRenewal.name}
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2 mt-1">
                      <Building2 className="h-4 w-4" />
                      {selectedRenewal.facilityName ?? "N/A"}
                    </DialogDescription>
                  </div>
                  <Badge className={statusConfig[getStatus(selectedRenewal.daysUntilExpiry)].color}>
                    {statusConfig[getStatus(selectedRenewal.daysUntilExpiry)].label}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Key Metrics */}
                <div className="grid gap-4 md:grid-cols-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Days Until Expiration</p>
                      <p className={`text-2xl font-bold ${selectedRenewal.daysUntilExpiry <= 30 ? "text-red-600" : ""}`}>
                        {selectedRenewal.daysUntilExpiry}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Total Spend</p>
                      <p className="text-2xl font-bold">{formatCurrency(selectedRenewal.totalSpend)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Rebate Earned</p>
                      <p className="text-2xl font-bold text-green-600">{formatCurrency(selectedRenewal.totalRebate)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Current Tier</p>
                      <p className="text-2xl font-bold">
                        {selectedRenewal.tierAchieved ?? "N/A"}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Contract Details */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Contract Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Contract Number</p>
                        <p className="font-medium">{selectedRenewal.contractNumber ?? "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Vendor</p>
                        <p className="font-medium">{selectedRenewal.vendorName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Expiration Date</p>
                        <p className="font-medium">{formatDate(selectedRenewal.expirationDate)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Auto Renewal</p>
                        <p className="font-medium">{selectedRenewal.autoRenewal ? "Yes" : "No"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  Close
                </Button>
                <Button variant="outline" onClick={() => handleContactFacility(selectedRenewal)}>
                  <Mail className="mr-2 h-4 w-4" />
                  Contact Facility
                </Button>
                <Button onClick={() => {
                  setDetailsOpen(false)
                  setProposeTermsOpen(true)
                }}>
                  <Send className="mr-2 h-4 w-4" />
                  Initiate Renewal
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Propose Terms Dialog */}
      <Dialog open={proposeTermsOpen} onOpenChange={setProposeTermsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Initiate Renewal</DialogTitle>
            <DialogDescription>
              {selectedRenewal && `Create a renewal for ${selectedRenewal.facilityName ?? selectedRenewal.name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Proposal Notes</Label>
              <Textarea
                placeholder="Describe your proposed terms, pricing changes, or new offerings..."
                value={proposalNotes}
                onChange={(e) => setProposalNotes(e.target.value)}
                rows={5}
              />
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              This will create a renewal draft contract from the current contract terms. The facility will be notified.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposeTermsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleProposeTerms} disabled={initiateRenewal.isPending}>
              <Send className="mr-2 h-4 w-4" />
              {initiateRenewal.isPending ? "Creating..." : "Initiate Renewal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

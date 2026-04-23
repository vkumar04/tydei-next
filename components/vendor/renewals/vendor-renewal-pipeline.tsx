"use client"

/**
 * Vendor renewals table + detail/propose dialogs.
 *
 * Historically this component also rendered summary cards, a timeline
 * and an internal Tabs strip — those responsibilities moved up to
 * `VendorRenewalsClient` (hero + control bar + outer tabs) in the
 * 2026-04-22 vendor-side hero+tabs redesign. This file now owns just
 * the filtered table and the two dialogs (details + propose terms).
 */

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  FileText,
  Eye,
  Mail,
  Send,
} from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { useSubmitRenewalProposal } from "@/hooks/use-renewals"
import type { ExpiringContract } from "@/lib/actions/renewals"
import { VendorRenewalNotesTimeline } from "./vendor-renewal-notes-timeline"

type UrgencyKey = "critical" | "warning" | "upcoming" | "ok"

const statusConfig: Record<
  UrgencyKey,
  { label: string; color: string; icon: typeof AlertTriangle }
> = {
  critical: {
    label: "Urgent",
    color:
      "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
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
    color:
      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    icon: Calendar,
  },
  ok: {
    label: "On Track",
    color:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    icon: CheckCircle2,
  },
}

function getUrgency(daysUntilExpiry: number): UrgencyKey {
  if (daysUntilExpiry <= 30) return "critical"
  if (daysUntilExpiry <= 90) return "warning"
  if (daysUntilExpiry <= 180) return "upcoming"
  return "ok"
}

interface VendorRenewalPipelineProps {
  contracts: ExpiringContract[]
  emptyMessage?: string
}

export function VendorRenewalPipeline({
  contracts,
  emptyMessage = "No contracts in this stage",
}: VendorRenewalPipelineProps) {
  const [selectedRenewal, setSelectedRenewal] =
    useState<ExpiringContract | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [proposeTermsOpen, setProposeTermsOpen] = useState(false)
  const [proposalNotes, setProposalNotes] = useState("")

  const submitProposal = useSubmitRenewalProposal()

  const renewals = contracts
    .map((c) => ({ ...c, urgency: getUrgency(c.daysUntilExpiry) }))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)

  const handleViewDetails = (renewal: ExpiringContract) => {
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
    if (proposalNotes.trim().length === 0) {
      toast.error("Add proposal notes before submitting")
      return
    }
    submitProposal.mutate(
      {
        contractId: selectedRenewal.id,
        notes: proposalNotes.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Proposal submitted", {
            description: `Renewal proposal sent to ${selectedRenewal.facilityName ?? "facility"}`,
          })
          setProposeTermsOpen(false)
          setProposalNotes("")
        },
        onError: (e) => {
          toast.error("Failed to submit proposal", { description: e.message })
        },
      },
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Renewals by Facility</CardTitle>
          <CardDescription>
            Click on a renewal to view details and propose terms
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renewals.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Total Spend</TableHead>
                  <TableHead>Rebate Earned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renewals.map((renewal) => {
                  const StatusIcon = statusConfig[renewal.urgency].icon
                  return (
                    <TableRow
                      key={renewal.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleViewDetails(renewal)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {renewal.facilityName ?? "N/A"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span>{renewal.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {renewal.contractType?.replace(/_/g, " ") ?? "N/A"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(renewal.expirationDate)}</TableCell>
                      <TableCell>
                        <span
                          className={
                            renewal.daysUntilExpiry <= 30
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : ""
                          }
                        >
                          {renewal.daysUntilExpiry} days
                        </span>
                      </TableCell>
                      <TableCell>{formatCurrency(renewal.totalSpend)}</TableCell>
                      <TableCell className="text-green-600 dark:text-green-400">
                        {formatCurrency(renewal.totalRebate)}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusConfig[renewal.urgency].color}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {statusConfig[renewal.urgency].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleContactFacility(renewal)}
                          >
                            <Mail className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetails(renewal)}
                          >
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
        </CardContent>
      </Card>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
                  <Badge
                    className={
                      statusConfig[getUrgency(selectedRenewal.daysUntilExpiry)].color
                    }
                  >
                    {statusConfig[getUrgency(selectedRenewal.daysUntilExpiry)].label}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="space-y-6 py-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">
                        Days Until Expiration
                      </p>
                      <p
                        className={`text-2xl font-bold ${
                          selectedRenewal.daysUntilExpiry <= 30
                            ? "text-red-600 dark:text-red-400"
                            : ""
                        }`}
                      >
                        {selectedRenewal.daysUntilExpiry}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Total Spend</p>
                      <p className="text-2xl font-bold">
                        {formatCurrency(selectedRenewal.totalSpend)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Rebate Earned</p>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(selectedRenewal.totalRebate)}
                      </p>
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

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Contract Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Contract Number</p>
                        <p className="font-medium">
                          {selectedRenewal.contractNumber ?? "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Vendor</p>
                        <p className="font-medium">{selectedRenewal.vendorName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Expiration Date</p>
                        <p className="font-medium">
                          {formatDate(selectedRenewal.expirationDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Auto Renewal</p>
                        <p className="font-medium">
                          {selectedRenewal.autoRenewal ? "Yes" : "No"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Renewal Notes
                    </CardTitle>
                    <CardDescription>
                      Context posted by the facility team, newest first
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <VendorRenewalNotesTimeline
                      contractId={selectedRenewal.id}
                    />
                  </CardContent>
                </Card>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleContactFacility(selectedRenewal)}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Contact Facility
                </Button>
                <Button
                  onClick={() => {
                    setDetailsOpen(false)
                    setProposeTermsOpen(true)
                  }}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Propose Terms
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={proposeTermsOpen} onOpenChange={setProposeTermsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Propose Renewal Terms</DialogTitle>
            <DialogDescription>
              {selectedRenewal &&
                `Send a renewal proposal to ${selectedRenewal.facilityName ?? selectedRenewal.name}`}
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
              This will submit a renewal proposal to the facility for review.
              They can approve, reject, or request revisions.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProposeTermsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleProposeTerms}
              disabled={submitProposal.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {submitProposal.isPending ? "Submitting..." : "Submit Proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

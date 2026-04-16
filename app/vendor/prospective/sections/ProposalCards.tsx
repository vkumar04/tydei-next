"use client"

import { useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FileText,
  DollarSign,
  Plus,
  Eye,
  Pencil,
  Trash2,
  MoreHorizontal,
  AlertTriangle,
  Lightbulb,
  Package,
  Calendar,
  Building2,
} from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { RecommendationBadge, StatusBadge, generateDealScore, scoreColor } from "./shared"
import { generateInsights } from "./insights"
import type { VendorProposal } from "@/lib/actions/prospective"

interface Props {
  proposals: VendorProposal[]
  isLoading: boolean
  onNewProposal: () => void
}

export function ProposalCards({ proposals, isLoading, onNewProposal }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<VendorProposal | null>(null)
  const [viewTarget, setViewTarget] = useState<VendorProposal | null>(null)

  const enrichedProposals = useMemo(() => {
    return proposals.map((p) => {
      const score = p.dealScore ?? generateDealScore(p.id)
      const insights = generateInsights(p.id)
      return { ...p, computedScore: score, ...insights }
    })
  }, [proposals])

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            My Contract Proposals
            <Badge variant="outline" className="font-normal text-xs">
              Internal Use Only
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground">
            Internal vendor analysis documents - edit and rework proposals as needed
          </p>
        </div>
        <Button size="sm" onClick={onNewProposal}>
          <Plus className="mr-2 h-4 w-4" />
          New Proposal
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : enrichedProposals.length > 0 ? (
        <div className="space-y-4">
          {enrichedProposals.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col lg:flex-row">
                  <div className="flex-1 p-5 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-muted-foreground">
                        #{p.id.slice(0, 8)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          p.computedScore.overall >= 80
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : p.computedScore.overall >= 65
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : p.computedScore.overall >= 40
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        Score: {p.computedScore.overall}
                      </span>
                      <RecommendationBadge recommendation={p.computedScore.recommendation} />
                      <StatusBadge status={p.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {p.facilityIds.length} facilities
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        {p.itemCount} products
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <DollarSign className="h-3.5 w-3.5" />
                        {formatCurrency(p.totalProposedCost)}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2">
                      {p.warnings.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {p.warnings.map((w) => (
                            <span
                              key={w}
                              className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800/40"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {w}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.opportunities.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {p.opportunities.map((o) => (
                            <span
                              key={o}
                              className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs text-green-800 ring-1 ring-inset ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-800/40"
                            >
                              <Lightbulb className="h-3 w-3" />
                              {o}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t p-4 lg:border-l lg:border-t-0 lg:flex-col lg:justify-center lg:px-5">
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setViewTarget(p)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">No proposals yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a new proposal to get started
            </p>
            <Button size="sm" className="mt-4" onClick={onNewProposal}>
              <Plus className="mr-2 h-4 w-4" />
              New Proposal
            </Button>
          </CardContent>
        </Card>
      )}

      {viewTarget && (
        <Dialog open onOpenChange={() => setViewTarget(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Proposal Details</DialogTitle>
              <DialogDescription>Proposal #{viewTarget.id.slice(0, 8)}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: "Status", node: <StatusBadge status={viewTarget.status} /> },
                { label: "Created", node: new Date(viewTarget.createdAt).toLocaleDateString() },
                { label: "Items", node: viewTarget.itemCount },
                { label: "Facilities", node: viewTarget.facilityIds.length },
                { label: "Projected Cost", node: formatCurrency(viewTarget.totalProposedCost) },
                {
                  label: "Deal Score",
                  node: (
                    <span
                      className={`font-semibold ${scoreColor(
                        viewTarget.dealScore?.overall ?? generateDealScore(viewTarget.id).overall,
                      )}`}
                    >
                      {viewTarget.dealScore?.overall ?? generateDealScore(viewTarget.id).overall}/100
                    </span>
                  ),
                },
              ].map((row) => (
                <div key={row.label}>
                  <p className="text-muted-foreground">{row.label}</p>
                  <p className="font-medium">{row.node}</p>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewTarget(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Proposal</DialogTitle>
              <DialogDescription>Are you sure? This action cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setDeleteTarget(null)}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

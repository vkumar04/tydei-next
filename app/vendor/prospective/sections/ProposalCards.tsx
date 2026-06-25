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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  FileText,
  DollarSign,
  Plus,
  Eye,
  Trash2,
  MoreHorizontal,
  Package,
  Calendar,
  Building2,
  Rocket,
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import type { OppEngineHandoff } from "./OpportunityEngineSection"
import { StatusBadge, RecommendationBadge } from "./shared"
import { ProposalDetailDialog } from "./ProposalDetailDialog"
import { useDeleteProposal } from "@/hooks/use-prospective"
import type { VendorProposal } from "@/lib/actions/prospective"

interface Props {
  proposals: VendorProposal[]
  isLoading: boolean
  onNewProposal: () => void
  /** Push a scored deal into the Opportunity Engine (proposal → score → opp). */
  onAnalyzeInOpportunityEngine?: (deal: OppEngineHandoff) => void
}

export function ProposalCards({
  proposals,
  isLoading,
  onNewProposal,
  onAnalyzeInOpportunityEngine,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<VendorProposal | null>(null)
  const [viewTarget, setViewTarget] = useState<VendorProposal | null>(null)
  const deleteMut = useDeleteProposal()

  // Only proposals that have a real, server-attached deal score show a
  // numeric score. Previously this list rendered a deterministic mock
  // score seeded by id which Charles correctly flagged as "all hard
  // coded." Real scoring lives in the Deal Scorer tab
  // (`getVendorProspectiveAnalysis` with a proposal selected persists
  // `pricingData.dealScore` on the row — audit H2).
  const enrichedProposals = useMemo(() => proposals, [proposals])

  function handleConfirmDelete() {
    if (!deleteTarget) return
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            My Contract Proposals
            <Badge variant="outline" className="font-normal text-xs">
              Internal Use Only
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground">
            Internal vendor analysis documents — score them in the Deal
            Scorer tab, or delete and recreate to rework
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
                      {p.dealScore ? (
                        <>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              p.dealScore.overall >= 80
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                : p.dealScore.overall >= 65
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : p.dealScore.overall >= 40
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            }`}
                          >
                            Score: {p.dealScore.overall}
                          </span>
                          <RecommendationBadge recommendation={p.dealScore.recommendation} />
                        </>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              Score: —
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Score not yet computed. Run the Deal Scorer with
                            this proposal selected to attach a score.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <StatusBadge status={p.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {p.facilityIds.length} facilit
                        {p.facilityIds.length === 1 ? "y" : "ies"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        {p.itemCount} products
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(p.createdAt)}
                      </span>
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <DollarSign className="h-3.5 w-3.5" />
                        {formatCurrency(p.totalProposedCost)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t p-4 lg:border-l lg:border-t-0 lg:flex-col lg:justify-center lg:px-5">
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setViewTarget(p)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                    {p.dealHandoff && onAnalyzeInOpportunityEngine && (
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          onAnalyzeInOpportunityEngine({
                            proposalId: p.id,
                            savedProposalId: p.id,
                            facilityId: p.dealHandoff!.facilityId,
                            priceChangePct: p.dealHandoff!.priceChangePct,
                            targetSharePct: p.dealHandoff!.targetSharePct,
                            constructs: p.dealHandoff!.constructs,
                          })
                        }
                        title="Pre-fill the Opportunity Engine with this scored deal"
                      >
                        <Rocket className="mr-2 h-4 w-4" />
                        Opportunity Engine
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* No Edit item: no edit flow exists for proposals
                            (audit L9) — delete + recreate is the rework path. */}
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
        <ProposalDetailDialog
          proposal={viewTarget}
          onClose={() => setViewTarget(null)}
        />
      )}

      {deleteTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !deleteMut.isPending) setDeleteTarget(null)
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Proposal</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete proposal #{deleteTarget.id.slice(0, 8)}?
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMut.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </TooltipProvider>
  )
}

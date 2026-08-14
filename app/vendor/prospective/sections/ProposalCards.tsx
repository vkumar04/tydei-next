"use client"

import { useState } from "react"
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
import type { DividendProposalListItem } from "@/lib/actions/dividend-proposals"
import { Landmark } from "lucide-react"
import type { OppEngineHandoff } from "./OpportunityEngineSection"
import { StatusBadge, RecommendationBadge } from "./shared"
import { ProposalDetailDialog } from "./ProposalDetailDialog"
import { useDeleteProposal } from "@/hooks/use-prospective"
import type { VendorProposal } from "@/lib/actions/prospective"

interface Props {
  proposals: VendorProposal[]
  /** Saved Dividend/DCF proposals — a DIFFERENT object with different maths. */
  dividendProposals?: DividendProposalListItem[]
  /** Opens one in the Dividend/DCF tab, never the contract-proposal dialog. */
  onOpenDividendProposal?: (id: string) => void
  isLoading: boolean
  onNewProposal: () => void
  /** Push a scored deal into the Opportunity Engine (proposal → score → opp). */
  onAnalyzeInOpportunityEngine?: (deal: OppEngineHandoff) => void
  /** Open a saved proposal in the builder to edit it in place. */
  onEditProposal?: (id: string) => void
}

export function ProposalCards({
  proposals,
  dividendProposals = [],
  onOpenDividendProposal,
  isLoading,
  onNewProposal,
  onAnalyzeInOpportunityEngine,
  onEditProposal,
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
  const enrichedProposals = proposals

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

      {dividendProposals.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Dividend / DCF proposals</h3>
            <Badge variant="secondary" className="px-1.5 text-[10px]">
              {dividendProposals.length}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Saved purchase-impact models. Opening one restores it in the
            Dividend / DCF tab — a different analysis from a contract proposal.
          </p>
          {dividendProposals.map((d) => (
            <Card
              key={d.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${d.name} in the Dividend / DCF tab`}
              onClick={() => onOpenDividendProposal?.(d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onOpenDividendProposal?.(d.id)
                }
              }}
              className="cursor-pointer transition-colors hover:border-foreground/30"
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    {d.verdict ? (
                      <Badge
                        variant="outline"
                        className={
                          d.verdict === "accretive"
                            ? "border-emerald-600/40 text-emerald-600 dark:text-emerald-400"
                            : d.verdict === "dilutive"
                              ? "border-red-600/40 text-red-600 dark:text-red-400"
                              : ""
                        }
                      >
                        {d.verdict}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {d.facilityLabel} · {formatDate(d.updatedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-6 text-right">
                  {d.recomputed ? (
                    <>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">
                          Dividend / yr
                        </div>
                        <div className="text-sm font-semibold tabular-nums">
                          {(d.annualDividendImpact ?? 0) >= 0 ? "+" : ""}
                          {formatCurrency(d.annualDividendImpact ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">
                          NPV
                        </div>
                        <div className="text-sm font-semibold tabular-nums">
                          {formatCurrency(d.netPresentValue ?? 0)}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="max-w-[14rem] text-[11px] text-muted-foreground">
                      Figures unavailable — open and re-save this proposal
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

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
                      {p.name ? (
                        <span className="text-sm font-semibold">{p.name}</span>
                      ) : null}
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
                      {/* Projected annual spend (the user-owned assumption),
                          falling back to the catalog cost (Σ price × qty)
                          for proposals without one — keeps this card in
                          agreement with the hero + detail dialog. */}
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <DollarSign className="h-3.5 w-3.5" />
                        {formatCurrency(p.projectedSpend ?? p.totalProposedCost)}
                        <span className="font-normal text-muted-foreground">
                          projected annual spend
                          {p.projectedSpend == null && " (catalog cost)"}
                        </span>
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
                            capitalRevenue: p.dealHandoff!.capitalRevenue,
                            // The saved deal's own current revenue — keeps the
                            // engine seeded from the deal, not book defaults
                            // (bugs.rtfd 2026-07-07).
                            currentRevenue:
                              p.dealHandoff!.currentAnnualSpend > 0
                                ? p.dealHandoff!.currentAnnualSpend
                                : null,
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
                        {/* Edit lives in the detail dialog (View → Edit,
                            lifecycle 5/4); legacy Alert rows hide it there. */}
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
          // Legacy pre-split Alert rows can't be saved by updateProposal —
          // offering Edit would fail AFTER the user redoes the form (D9).
          onEdit={viewTarget.editable ? onEditProposal : undefined}
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

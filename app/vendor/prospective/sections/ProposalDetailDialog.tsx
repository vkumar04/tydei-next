"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { StatusBadge, RecommendationBadge, scoreColor } from "./shared"
import { useVendorProposalDetail } from "@/hooks/use-prospective"
import type {
  VendorProposal,
  ProposedPricingItem,
} from "@/lib/actions/prospective"

interface Props {
  proposal: VendorProposal
  onClose: () => void
}

/**
 * Full "Proposal Details" dialog — surfaces everything the builder tabs
 * captured (not just the summary). The list row (`proposal`) renders the
 * header + Overview facts instantly; the rich payload (pricing rows, term
 * extras, divisions, facility names) is fetched on open via
 * `useVendorProposalDetail` and fills the Pricing / Terms / Facilities tabs.
 */
export function ProposalDetailDialog({ proposal, onClose }: Props) {
  const { data: detail, isLoading } = useVendorProposalDetail(proposal.id)

  // Header + Overview can render from the lean list row immediately; the
  // detail-only fields fall back to the list row where they overlap.
  const p = detail ?? proposal

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Proposal Details
            <StatusBadge status={p.status} />
            {p.dealScore && (
              <RecommendationBadge recommendation={p.dealScore.recommendation} />
            )}
          </DialogTitle>
          <DialogDescription>
            Proposal #{proposal.id.slice(0, 8)} · created{" "}
            {formatDate(proposal.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1 overflow-hidden flex flex-col">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="pricing">
              Pricing
              <span className="ml-1 text-xs text-muted-foreground">
                ({proposal.itemCount.toLocaleString()})
              </span>
            </TabsTrigger>
            <TabsTrigger value="terms">
              Terms
              {p.terms && p.terms.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({p.terms.length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="score">Deal Score</TabsTrigger>
            <TabsTrigger value="deal">
              Deal
              {detail?.dealConstructs && detail.dealConstructs.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({detail.dealConstructs.length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="facilities">
              Facilities
              <span className="ml-1 text-xs text-muted-foreground">
                ({proposal.facilityIds.filter((f) => f && f !== "none").length})
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto pt-4">
            <OverviewTab proposal={p} />
            <PricingTab
              items={detail?.pricingItems ?? []}
              total={p.totalProposedCost}
              isLoading={isLoading}
            />
            <TermsTab proposal={p} detail={detail} isLoading={isLoading} />
            <ScoreTab proposal={p} />
            <DealTab detail={detail} isLoading={isLoading} />
            <FacilitiesTab detail={detail} isLoading={isLoading} />
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Overview ───────────────────────────────────────────────────

function OverviewTab({ proposal }: { proposal: VendorProposal }) {
  const facts: { label: string; node: React.ReactNode }[] = [
    { label: "Status", node: <StatusBadge status={proposal.status} /> },
    { label: "Created", node: formatDate(proposal.createdAt) },
    { label: "Items", node: proposal.itemCount.toLocaleString() },
    {
      label: "Facilities",
      node: proposal.facilityIds.filter((f) => f && f !== "none").length,
    },
    { label: "Projected Cost", node: formatCurrency(proposal.totalProposedCost) },
    ...(proposal.contractLengthMonths != null
      ? [{ label: "Contract Length", node: `${proposal.contractLengthMonths} mo` }]
      : []),
    ...(proposal.projectedSpend != null
      ? [{ label: "Projected Spend", node: formatCurrency(proposal.projectedSpend) }]
      : []),
    ...(proposal.projectedVolume != null
      ? [{ label: "Projected Volume", node: proposal.projectedVolume.toLocaleString() }]
      : []),
    ...(proposal.marketShareCommitment != null
      ? [{ label: "Market Share", node: `${proposal.marketShareCommitment}%` }]
      : []),
    ...(proposal.gpoFee != null
      ? [{ label: "GPO Admin Fee", node: `${proposal.gpoFee}%` }]
      : []),
    {
      label: "Deal Score",
      node: proposal.dealScore ? (
        <span className={`font-semibold ${scoreColor(proposal.dealScore.overall)}`}>
          {proposal.dealScore.overall}/100
        </span>
      ) : (
        <span className="text-muted-foreground">— not yet computed</span>
      ),
    },
  ]

  return (
    <TabsContent value="overview" className="mt-0 space-y-5">
      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        {facts.map((row) => (
          <div key={row.label}>
            <p className="text-xs text-muted-foreground">{row.label}</p>
            <p className="font-medium">{row.node}</p>
          </div>
        ))}
      </div>

      {proposal.productCategories && proposal.productCategories.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Product Categories</p>
          <div className="flex flex-wrap gap-1">
            {proposal.productCategories.map((c) => (
              <Badge key={c} variant="secondary" className="text-xs">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {proposal.aiNotes && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Deal Notes</p>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
            {proposal.aiNotes}
          </p>
        </div>
      )}
    </TabsContent>
  )
}

// ─── Pricing ────────────────────────────────────────────────────

function PricingTab({
  items,
  total,
  isLoading,
}: {
  items: ProposedPricingItem[]
  total: number
  isLoading: boolean
}) {
  const columns = useMemo<ColumnDef<ProposedPricingItem>[]>(
    () => [
      {
        // Combined item# + description so the single search box matches both.
        id: "item",
        accessorFn: (r) => `${r.vendorItemNo} ${r.description ?? ""}`,
        header: "Item / Description",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-mono text-xs text-muted-foreground">
              {row.original.vendorItemNo}
            </div>
            {row.original.description && (
              <div className="truncate text-sm">{row.original.description}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "proposedPrice",
        header: "Proposed",
        cell: ({ row }) => formatCurrency(row.original.proposedPrice),
      },
      {
        accessorKey: "currentPrice",
        header: "Current",
        cell: ({ row }) =>
          row.original.currentPrice != null
            ? formatCurrency(row.original.currentPrice)
            : "—",
      },
      {
        accessorKey: "quantity",
        header: "Qty",
        cell: ({ row }) => (row.original.quantity ?? 1).toLocaleString(),
      },
      {
        id: "extended",
        header: "Extended",
        accessorFn: (r) => r.proposedPrice * (r.quantity ?? 1),
        cell: ({ row }) =>
          formatCurrency(
            row.original.proposedPrice * (row.original.quantity ?? 1),
          ),
      },
    ],
    [],
  )

  const avg = items.length > 0 ? total / items.length : 0

  return (
    <TabsContent value="pricing" className="mt-0 space-y-3">
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No pricing line items were captured for this proposal.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">
                {items.length.toLocaleString()}
              </span>{" "}
              line items
            </span>
            <span>
              Total proposed:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(total)}
              </span>
            </span>
            <span>
              Avg / item:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(avg)}
              </span>
            </span>
          </div>
          <DataTable
            columns={columns}
            data={items}
            searchKey="item"
            searchPlaceholder="Search item # or description…"
            pageSize={10}
          />
        </>
      )}
    </TabsContent>
  )
}

// ─── Terms ──────────────────────────────────────────────────────

function TermsTab({
  proposal,
  detail,
  isLoading,
}: {
  proposal: VendorProposal
  detail: import("@/lib/actions/prospective").VendorProposalDetail | undefined
  isLoading: boolean
}) {
  const structure: { label: string; value: React.ReactNode }[] = [
    ...(proposal.contractLengthMonths != null
      ? [{ label: "Contract Length", value: `${proposal.contractLengthMonths} mo` }]
      : []),
    ...(detail?.startDate
      ? [{ label: "Start Date", value: formatDate(detail.startDate) }]
      : []),
    ...(detail?.paymentTerms
      ? [{ label: "Payment Terms", value: detail.paymentTerms }]
      : []),
    ...(proposal.gpoFee != null
      ? [{ label: "GPO Admin Fee", value: `${proposal.gpoFee}%` }]
      : []),
    ...(proposal.marketShareCommitment != null
      ? [{ label: "Market Share Commitment", value: `${proposal.marketShareCommitment}%` }]
      : []),
  ]

  return (
    <TabsContent value="terms" className="mt-0 space-y-5">
      {structure.length > 0 && (
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          {structure.map((row) => (
            <div key={row.label}>
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="font-medium">{row.value}</p>
            </div>
          ))}
        </div>
      )}

      {proposal.terms && proposal.terms.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Rebate Terms</p>
          <div className="space-y-2">
            {proposal.terms.map((t, i) => (
              <div key={i} className="rounded-md border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {t.name || t.termType.replace(/_/g, " ")}
                  </span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {t.termType.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  {t.targetType && (
                    <span>
                      Target ({t.targetType}):{" "}
                      <span className="text-foreground">
                        {t.targetType === "spend"
                          ? formatCurrency(t.targetValue ?? 0)
                          : (t.targetValue ?? 0).toLocaleString()}
                      </span>
                    </span>
                  )}
                  {t.rebatePercent != null && (
                    <span>
                      Rebate:{" "}
                      <span className="text-foreground">{t.rebatePercent}%</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        !isLoading && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No rebate terms were configured for this proposal.
          </p>
        )
      )}

      {detail?.termsNotes && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Term Notes</p>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
            {detail.termsNotes}
          </p>
        </div>
      )}
    </TabsContent>
  )
}

// ─── Deal Score ─────────────────────────────────────────────────

function ScoreTab({ proposal }: { proposal: VendorProposal }) {
  return (
    <TabsContent value="score" className="mt-0">
      {proposal.dealScore ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Overall Score</p>
              <p className={`text-4xl font-bold ${scoreColor(proposal.dealScore.overall)}`}>
                {proposal.dealScore.overall}
                <span className="text-lg text-muted-foreground">/100</span>
              </p>
            </div>
            <div className="pb-1">
              <RecommendationBadge recommendation={proposal.dealScore.recommendation} />
            </div>
          </div>
          {proposal.dealScore.scoredAt && (
            <p className="text-xs text-muted-foreground">
              Scored {formatDate(proposal.dealScore.scoredAt)}
            </p>
          )}
          <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            A single 0–100 score anchored on the deal&rsquo;s gross margin vs your
            target/floor, plus penetration and term factors. The per-product deal
            it was scored on is in the <span className="font-medium">Deal</span>{" "}
            tab. Re-run the Deal Scorer with this proposal selected to refresh it.
          </p>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No deal score yet. Run the Deal Scorer with this proposal selected to
          attach a score.
        </p>
      )}
    </TabsContent>
  )
}

// ─── Deal (per-construct breakdown) ─────────────────────────────

function DealTab({
  detail,
  isLoading,
}: {
  detail: import("@/lib/actions/prospective").VendorProposalDetail | undefined
  isLoading: boolean
}) {
  const constructs = detail?.dealConstructs ?? []
  return (
    <TabsContent value="deal" className="mt-0">
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : constructs.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No deal yet. Score this proposal in the Deal Scorer to capture the
          per-product deal (Current / Floor / Target / Ask).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Product</th>
                <th className="px-3 py-2 text-right font-medium">Current</th>
                <th className="px-3 py-2 text-right font-medium">Floor</th>
                <th className="px-3 py-2 text-right font-medium">Target</th>
                <th className="px-3 py-2 text-right font-medium">Ask</th>
                <th className="px-3 py-2 text-right font-medium">Volume</th>
                <th className="px-3 py-2 text-right font-medium">Rebate %</th>
              </tr>
            </thead>
            <tbody>
              {constructs.map((c, i) => (
                <tr key={`${c.productName}-${i}`} className="border-t">
                  <td className="px-3 py-2">{c.productName || "(unnamed)"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.current ? formatCurrency(c.current) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.floor ? formatCurrency(c.floor) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.target ? formatCurrency(c.target) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.ask ? formatCurrency(c.ask) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.annualVolume.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.rebatePercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TabsContent>
  )
}

// ─── Facilities ─────────────────────────────────────────────────

function FacilitiesTab({
  detail,
  isLoading,
}: {
  detail: import("@/lib/actions/prospective").VendorProposalDetail | undefined
  isLoading: boolean
}) {
  return (
    <TabsContent value="facilities" className="mt-0 space-y-5">
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded" />
          ))}
        </div>
      ) : (
        <>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Targeted Facilities</p>
            {detail && detail.facilities.length > 0 ? (
              <div className="space-y-1.5">
                {detail.facilities.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-md border px-3 py-2 text-sm font-medium"
                  >
                    {f.name}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No specific facility targeted (open / market-wide proposal).
              </p>
            )}
          </div>

          {detail?.divisions && detail.divisions.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Divisions</p>
              <div className="flex flex-wrap gap-1">
                {detail.divisions.map((d) => (
                  <Badge key={d} variant="secondary" className="text-xs">
                    {d}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </TabsContent>
  )
}

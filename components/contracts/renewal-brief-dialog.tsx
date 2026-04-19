"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { Copy, RefreshCw, Sparkles } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import {
  useRegenerateRenewalBrief,
  useRenewalBrief,
} from "@/hooks/use-renewal-brief"
import type { RenewalBrief } from "@/lib/ai/renewal-brief-schemas"

interface RenewalBriefDialogProps {
  contractId: string
  contractName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Renewal Brief dialog — Tier 4 of the Rebate Optimizer AI spec.
 *
 * Renders the Claude-generated negotiation primer in a scrollable modal.
 * Driven by `useRenewalBrief` (lazy, kicks off when the dialog opens) and
 * `useRegenerateRenewalBrief` (bypasses the 1-hour server cache).
 */
export function RenewalBriefDialog({
  contractId,
  contractName,
  open,
  onOpenChange,
}: RenewalBriefDialogProps) {
  const query = useRenewalBrief(contractId, { enabled: open })
  const regenerate = useRegenerateRenewalBrief(contractId)

  const isPending = query.isFetching || regenerate.isPending
  const brief = query.data

  // Kick a refetch when the user re-opens the modal if we already have
  // cached client data — TanStack's staleTime keeps it warm, but we want
  // the loading UX to feel responsive on first-open regardless.
  useEffect(() => {
    if (!open) return
    if (!query.data && !query.isFetching && !query.error) {
      void query.refetch()
    }
  }, [open, query])

  async function copyMarkdown() {
    if (!brief) return
    const md = briefToMarkdown(brief, contractName)
    try {
      await navigator.clipboard.writeText(md)
      toast.success("Copied renewal brief as Markdown")
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            Renewal Brief — {contractName}
          </DialogTitle>
        </DialogHeader>

        {query.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to generate renewal brief:{" "}
            {query.error instanceof Error
              ? query.error.message
              : "Unknown error"}
          </div>
        ) : isPending || !brief ? (
          <BriefSkeleton />
        ) : (
          <BriefBody brief={brief} />
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={copyMarkdown}
            disabled={!brief || isPending}
          >
            <Copy className="mr-2 size-4" />
            Copy as Markdown
          </Button>
          <Button
            variant="outline"
            onClick={() => regenerate.mutate()}
            disabled={isPending}
          >
            <RefreshCw
              className={`mr-2 size-4 ${regenerate.isPending ? "animate-spin" : ""}`}
            />
            Regenerate
          </Button>
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Body ──────────────────────────────────────────────────────────

function BriefBody({ brief }: { brief: RenewalBrief }) {
  const generated = (() => {
    const d = new Date(brief.generatedAt)
    return Number.isNaN(d.getTime()) ? brief.generatedAt : formatDate(d)
  })()

  return (
    <div className="space-y-6 text-sm">
      {/* ── Executive summary ─────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-base font-semibold">Executive Summary</h3>
        <p className="leading-relaxed text-muted-foreground">
          {brief.executiveSummary}
        </p>
      </section>

      {/* ── Performance summary ───────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-base font-semibold">Performance Summary</h3>
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
          <Stat label="Term" value={`${brief.performanceSummary.termMonths} mo`} />
          <Stat
            label="Total spend"
            value={formatCurrency(brief.performanceSummary.totalSpend)}
          />
          <Stat
            label="Projected spend"
            value={formatCurrency(brief.performanceSummary.projectedFullSpend)}
          />
          <Stat
            label="Capture rate"
            value={`${Math.round(brief.performanceSummary.captureRate * 100)}%`}
          />
        </div>

        {brief.performanceSummary.missedTiers.length > 0 ? (
          <div className="mt-3">
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">
              Missed tiers
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Shortfall</TableHead>
                  <TableHead className="text-right">Lost rebate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brief.performanceSummary.missedTiers.map((m, i) => (
                  <TableRow key={`${m.quarter}-${m.tierMissed}-${i}`}>
                    <TableCell className="font-mono text-xs">
                      {m.quarter}
                    </TableCell>
                    <TableCell>Tier {m.tierMissed}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(m.shortfallDollars)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {formatCurrency(m.estimatedLostRebate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No missed tiers across the rebate history.
          </p>
        )}
      </section>

      {/* ── Primary asks ──────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-base font-semibold">Primary Asks</h3>
        <ol className="space-y-3">
          {brief.primaryAsks.map((ask) => (
            <li
              key={`ask-${ask.rank}`}
              className="rounded-md border p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Badge variant="secondary" className="mt-0.5">
                    #{ask.rank}
                  </Badge>
                  <p className="font-medium leading-snug">{ask.ask}</p>
                </div>
                {ask.quantifiedImpact ? (
                  <span className="shrink-0 rounded border bg-muted px-2 py-0.5 text-xs font-medium">
                    {ask.quantifiedImpact}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {ask.rationale}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Concessions on the table ──────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-base font-semibold">Concessions On Table</h3>
        {brief.concessionsOnTable.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No concessions flagged by Claude.
          </p>
        ) : (
          <ul className="space-y-2">
            {brief.concessionsOnTable.map((c, i) => (
              <li
                key={`concession-${i}`}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <span className="leading-snug">{c.concession}</span>
                {c.estimatedCost ? (
                  <span className="shrink-0 rounded border bg-muted px-2 py-0.5 text-xs font-medium">
                    {c.estimatedCost}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Generated by Claude Opus 4.6 on {generated}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

function BriefSkeleton() {
  return (
    <div className="space-y-6">
      {/* Executive summary */}
      <section>
        <Skeleton className="mb-2 h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-1.5 h-4 w-5/6" />
      </section>
      {/* Performance summary */}
      <section>
        <Skeleton className="mb-3 h-5 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </section>
      {/* Missed tiers table */}
      <section>
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-24 w-full" />
      </section>
      {/* Primary asks */}
      <section>
        <Skeleton className="mb-3 h-5 w-36" />
        <Skeleton className="mb-2 h-16 w-full" />
        <Skeleton className="mb-2 h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
      {/* Concessions */}
      <section>
        <Skeleton className="mb-3 h-5 w-48" />
        <Skeleton className="mb-2 h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
      {/* Footer */}
      <Skeleton className="h-3 w-64" />
    </div>
  )
}

// ─── Markdown helper ───────────────────────────────────────────────

/**
 * Render a `RenewalBrief` to Markdown for the "Copy as Markdown" button.
 * Exported for unit tests.
 */
export function briefToMarkdown(
  brief: RenewalBrief,
  contractName: string,
): string {
  const perf = brief.performanceSummary
  const lines: string[] = []

  lines.push(`# Renewal Brief — ${contractName}`, "")
  lines.push("## Executive Summary", "", brief.executiveSummary, "")

  lines.push("## Performance Summary", "")
  lines.push(`- **Term:** ${perf.termMonths} months`)
  lines.push(`- **Total spend:** ${formatCurrency(perf.totalSpend)}`)
  lines.push(
    `- **Projected full-term spend:** ${formatCurrency(perf.projectedFullSpend)}`,
  )
  lines.push(
    `- **Capture rate:** ${Math.round(perf.captureRate * 100)}%`,
  )
  lines.push("")

  if (perf.missedTiers.length > 0) {
    lines.push("### Missed Tiers", "")
    lines.push("| Quarter | Tier | Shortfall | Lost Rebate |")
    lines.push("| --- | --- | --- | --- |")
    for (const m of perf.missedTiers) {
      lines.push(
        `| ${m.quarter} | Tier ${m.tierMissed} | ${formatCurrency(
          m.shortfallDollars,
        )} | ${formatCurrency(m.estimatedLostRebate)} |`,
      )
    }
    lines.push("")
  }

  lines.push("## Primary Asks", "")
  for (const ask of brief.primaryAsks) {
    const impact = ask.quantifiedImpact ? ` — **${ask.quantifiedImpact}**` : ""
    lines.push(`${ask.rank}. **${ask.ask}**${impact}`)
    lines.push(`   ${ask.rationale}`)
  }
  lines.push("")

  lines.push("## Concessions On Table", "")
  if (brief.concessionsOnTable.length === 0) {
    lines.push("_None._", "")
  } else {
    for (const c of brief.concessionsOnTable) {
      const cost = c.estimatedCost ? ` — _${c.estimatedCost}_` : ""
      lines.push(`- ${c.concession}${cost}`)
    }
    lines.push("")
  }

  const generatedDate = (() => {
    const d = new Date(brief.generatedAt)
    return Number.isNaN(d.getTime()) ? brief.generatedAt : formatDate(d)
  })()
  lines.push(`_Generated by Claude Opus 4.6 on ${generatedDate}._`)

  return lines.join("\n")
}

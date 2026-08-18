"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Calculator,
  Link2,
  Link2Off,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency, formatCompactCurrency } from "@/lib/formatting"
import {
  getContractDcfBundle,
  type ContractDcfBundle,
  type LinkedDcfProposal,
  type ContractRebateLadder,
} from "@/lib/actions/contract-dcf-links"
import {
  useDividendProposals,
  useDividendProposalPayloads,
  useLinkDcfProposal,
  useUnlinkDcfProposal,
} from "@/hooks/use-dividend"
import {
  computeContractDcfProjection,
  type ContractDcfProjection,
} from "@/lib/financial-analysis/contract-dcf-projection"
import {
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  lineItemsToProforma,
} from "@/lib/financial-analysis/proforma-pnl"
import { resolveProposalAssumptions } from "@/lib/financial-analysis/dividend-proposal-summary"

const GOOD = "text-emerald-600 dark:text-emerald-400"
const BAD = "text-red-600 dark:text-red-400"

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: "good" | "bad"
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-semibold tabular-nums ${
          tone === "good" ? GOOD : tone === "bad" ? BAD : ""
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  )
}

/** One linked proposal, projected against THIS contract's rebate ladder. */
function LinkedProposalCard({
  proposal,
  ladder,
  baseAnnualSpend,
  growthOverride,
  onUnlink,
  unlinking,
}: {
  proposal: LinkedDcfProposal
  ladder: ContractRebateLadder | null
  baseAnnualSpend: number
  /** Whole percent, or null for "no override". */
  growthOverride: number | null
  onUnlink: (id: string) => void
  unlinking: boolean
}) {
  const assumptions = resolveProposalAssumptions(proposal.payload)

  const projection: ContractDcfProjection = useMemo(
    () =>
      computeContractDcfProjection({
        proforma: lineItemsToProforma(proposal.payload.lineItems),
        purchase: proposal.payload.purchase,
        assumptions,
        baseAnnualSpend,
        tiers: ladder?.tiers ?? [],
        // undefined = no override: run at the proposal's own growth rate, the
        // state in which this card and the Dividend/DCF tab agree exactly.
        usageGrowthPercent: growthOverride ?? undefined,
        rebateMethod: ladder?.rebateMethod,
        boundaryRule: ladder?.boundaryRule,
        spendBaseline: ladder?.spendBaseline ?? null,
        growthOnly: ladder?.growthOnly ?? false,
        periodCap: ladder?.annualSpendCap ?? null,
      }),
    [proposal, assumptions, ladder, baseAnnualSpend, growthOverride],
  )

  const positive = projection.netPresentValue > 0
  const Icon = positive ? TrendingUp : projection.netPresentValue < 0 ? TrendingDown : Minus

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className={`h-4 w-4 ${positive ? GOOD : BAD}`} />
              <span className="truncate">{proposal.name}</span>
            </CardTitle>
            <CardDescription>
              {proposal.facilityLabel} · projected over{" "}
              {assumptions.dcfProjectionYears} years at{" "}
              {projection.growthPercent > 0 ? "+" : ""}
              {Math.round(projection.growthPercent * 10) / 10}% growth / yr
              {growthOverride === null
                ? " (this proposal's own rate)"
                : " (override)"}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground"
            disabled={unlinking}
            onClick={() => onUnlink(proposal.id)}
          >
            <Link2Off className="h-3.5 w-3.5" />
            Unlink
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="NPV (net of capital)"
            value={formatCompactCurrency(projection.netPresentValue, { kDecimals: 1 })}
            sub={`proposal alone ${formatCompactCurrency(projection.proposalNetPresentValue, { kDecimals: 1 })}${
              projection.capitalOutlay > 0
                ? ` · after ${formatCompactCurrency(projection.capitalOutlay, { kDecimals: 1 })} outlay`
                : ""
            }`}
            tone={positive ? "good" : "bad"}
          />
          <Stat
            label="Payback"
            value={
              projection.paybackYears === null
                ? projection.capitalOutlay > 0
                  ? "Never"
                  : "n/a"
                : `${projection.paybackYears.toFixed(1)} yrs`
            }
            sub="cumulative PV turns positive"
          />
          <Stat
            label="Rebate returned"
            value={formatCompactCurrency(projection.totalRebate, { kDecimals: 1 })}
            sub={`${formatCompactCurrency(projection.totalRebatePv, { kDecimals: 1 })} PV to owners`}
            tone={projection.totalRebate > 0 ? "good" : undefined}
          />
          <Stat
            label="Rebate tier"
            value={
              projection.firstTier === 0 && projection.lastTier === 0
                ? "—"
                : projection.tierStepsUp
                  ? `T${projection.firstTier} → T${projection.lastTier}`
                  : `T${projection.lastTier}`
            }
            sub={
              projection.tierStepsUp
                ? "steps up as usage grows"
                : ladder
                  ? "flat across the term"
                  : "no spend-dollar ladder"
            }
            tone={projection.tierStepsUp ? "good" : undefined}
          />
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Cases</TableHead>
                <TableHead className="text-right">Contract spend</TableHead>
                <TableHead className="text-right">Tier</TableHead>
                <TableHead className="text-right">Rebate</TableHead>
                <TableHead className="text-right">Owner dividend</TableHead>
                <TableHead className="text-right">PV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projection.years.map((y) => (
                <TableRow key={y.year}>
                  <TableCell>Y{y.year}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.round(y.cases).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(y.contractSpend)}
                  </TableCell>
                  <TableCell className="text-right">
                    {y.tierAchieved > 0 ? (
                      <Badge variant="outline" className="text-[10px]">
                        T{y.tierAchieved}
                        {/* A flat-dollar tier has no percent rate, and
                            "T1 · 0%" beside a non-zero Rebate reads as a bug. */}
                        {y.rebatePercent > 0 ? ` · ${y.rebatePercent}%` : ""}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${y.rebate > 0 ? GOOD : ""}`}>
                    {formatCurrency(y.rebate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(y.ownerDividend)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(y.presentValue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Growth compounds both sides: more procedures lift the proposal&apos;s
          operating dividend and push more spend through this contract, whose
          cumulative spend is what steps the rebate tier.
          {ladder?.termName ? ` Ladder from “${ladder.termName}”.` : ""}
          {ladder?.growthOnly && ladder.spendBaseline
            ? ` Rebate accrues only on spend above the ${formatCurrency(ladder.spendBaseline)} annual growth baseline.`
            : ""}
          {ladder?.annualSpendCap != null
            ? ` Eligible spend is capped at ${formatCurrency(ladder.annualSpendCap)} per year.`
            : ""}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * DCF Analysis — how THIS contract affects the facility's Dividend/DCF
 * proposals (Charles 2026-08-13). Link one or more saved proposals and the tab
 * projects, year by year, the owner dividend they produce once this contract's
 * rebate ladder is layered on. The growth slider is the prospective lever;
 * everything re-derives from it and from live contract data.
 *
 * `persistLinks: false` serves an unapproved submission. ContractDcfLink is a
 * hard FK to Contract, so nothing can be saved against a PendingContract — the
 * vendor picks a proposal ad hoc and the selection lives in component state.
 * The projection itself is identical either way.
 */
export function ContractDcfTab({
  contractId,
  fetcher,
  persistLinks = true,
}: {
  contractId: string
  fetcher?: (id: string) => Promise<ContractDcfBundle>
  persistLinks?: boolean
}) {
  // null = no override: every card runs at its own proposal's cashFlowGrowthPct,
  // the state in which this tab's NPV equals the Dividend/DCF tab's exactly.
  const [growthOverride, setGrowthOverride] = useState<number | null>(null)
  const defaultGrowthPercent = Math.round(
    DEFAULT_DIVIDEND_ASSUMPTIONS.cashFlowGrowthPct * 100,
  )
  const growthValue = growthOverride ?? defaultGrowthPercent
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Ad-hoc selection when links cannot be persisted (unapproved submission). */
  const [localIds, setLocalIds] = useState<string[]>([])

  const { data: bundle, isLoading } = useQuery({
    queryKey: queryKeys.contracts.dcfBundle(contractId),
    queryFn: () => (fetcher ?? getContractDcfBundle)(contractId),
  })
  const { data: allProposals = [] } = useDividendProposals("")
  const { data: localProposals = [] } = useDividendProposalPayloads(
    persistLinks ? [] : localIds,
  )
  const linkMutation = useLinkDcfProposal()
  const unlinkMutation = useUnlinkDcfProposal()

  const linked = persistLinks ? (bundle?.linked ?? []) : localProposals
  const linkedIds = new Set(linked.map((l) => l.id))
  const available = allProposals.filter((p) => !linkedIds.has(p.id))

  const attach = (proposalId: string) => {
    if (persistLinks) {
      linkMutation.mutate(
        { contractId, proposalId },
        { onSuccess: () => setPickerOpen(false) },
      )
      return
    }
    setLocalIds((ids) => (ids.includes(proposalId) ? ids : [...ids, proposalId]))
    setPickerOpen(false)
  }

  const detach = (proposalId: string) => {
    if (persistLinks) {
      unlinkMutation.mutate({ contractId, proposalId })
      return
    }
    setLocalIds((ids) => ids.filter((id) => id !== proposalId))
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-5 w-5 text-muted-foreground" />
                {persistLinks
                  ? "DCF proposals linked to this contract"
                  : "DCF analysis for this submission"}
              </CardTitle>
              <CardDescription>
                See how this contract&apos;s rebate ladder feeds the projected
                owner dividend of a saved Dividend/DCF proposal.
                {bundle && bundle.baseAnnualSpend > 0
                  ? ` Year-1 contract spend basis: ${formatCurrency(bundle.baseAnnualSpend)}.`
                  : ""}
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setPickerOpen(true)}
            >
              <Link2 className="h-4 w-4" />
              {persistLinks ? "Link a proposal" : "Add a proposal"}
            </Button>
          </div>
        </CardHeader>
        {linked.length > 0 ? (
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Growth assumption
                {growthOverride === null ? " (proposal default)" : ""}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-medium tabular-nums">
                  {growthValue > 0 ? "+" : ""}
                  {growthValue}% / yr
                </span>
                {growthOverride !== null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setGrowthOverride(null)}
                  >
                    Reset
                  </Button>
                ) : null}
              </span>
            </div>
            <Slider
              value={[growthValue]}
              onValueChange={([v]) => setGrowthOverride(v)}
              min={-10}
              max={25}
              step={1}
              aria-label="Growth percent per year"
            />
            <p className="text-[11px] text-muted-foreground">
              Replaces each proposal&apos;s own cash-flow growth assumption. It
              drives the owner dividend AND this contract&apos;s annual spend, so
              it also determines how fast cumulative spend steps the rebate tier.
              Untouched, every card matches its proposal&apos;s Dividend/DCF NPV
              exactly.
            </p>
          </CardContent>
        ) : null}
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading linked proposals…
          </CardContent>
        </Card>
      ) : linked.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {persistLinks
              ? "No DCF proposals linked yet. Link one to see how this contract affects its projected dividend."
              : "Add a saved DCF proposal to project it against this submission's rebate ladder. Selections are not saved until the contract is approved."}
          </CardContent>
        </Card>
      ) : (
        linked.map((p) => (
          <LinkedProposalCard
            key={p.id}
            proposal={p}
            ladder={bundle?.ladder ?? null}
            baseAnnualSpend={bundle?.baseAnnualSpend ?? 0}
            growthOverride={growthOverride}
            unlinking={unlinkMutation.isPending}
            onUnlink={detach}
          />
        ))
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {persistLinks ? "Link a DCF proposal" : "Add a DCF proposal"}
            </DialogTitle>
            <DialogDescription>
              Saved Dividend/DCF proposals. Linking one projects it against this
              contract&apos;s rebate ladder.
            </DialogDescription>
          </DialogHeader>
          {available.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {allProposals.length === 0
                ? "No saved DCF proposals yet — build one on the Prospective → Dividend / DCF tab."
                : "Every saved proposal is already linked."}
            </div>
          ) : (
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {available.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={linkMutation.isPending}
                  onClick={() => attach(p.id)}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-left hover:bg-muted"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {p.facilityLabel}
                      {p.verdict ? ` · ${p.verdict}` : ""}
                    </div>
                  </div>
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

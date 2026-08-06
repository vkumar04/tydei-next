"use client"

import type { Dispatch, SetStateAction } from "react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { formatCurrency } from "@/lib/formatting"
import { cn } from "@/lib/utils"
import { PricingFileDropzone } from "@/components/shared/uploads/pricing-file-dropzone"
import {
  BUILDER_USAGE_UPLOAD_SPECS,
  BUILDER_PRICING_UPLOAD_SPECS,
} from "@/components/vendor/prospective/builder/file-handlers"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import type { VendorContractVariant } from "@/lib/prospective-analysis/vendor-prospective-analyzer"
import type { VendorProposal } from "@/lib/actions/prospective"
import { NO_PROPOSAL } from "./construct-form"

type ImportHandler = (
  rows: Record<string, string>[],
  mapping: ResolvedMapping,
  meta: { fileName: string; headers: string[] },
) => void

interface DealInputsHeaderProps {
  embedded: boolean
  /** In the one-page flow the facility, usage, pricing, and categories are
   *  BUILDER concerns — always inherit, never re-ask here (Charles 2026-07-06). */
  inheritInputs: boolean
  inheritedFacilityName: string | null
  usageLoadedCount: number
  priceLoadedCount: number
  actualsSyncMode: "two_way" | "one_way" | null
  facilityId: string
  setFacilityId: (facilityId: string) => void
  facilities: { id: string; name: string }[]
  contractVariant: VendorContractVariant
  setContractVariant: Dispatch<SetStateAction<VendorContractVariant>>
  proposalRowId: string
  /** Parent updates the selection AND the detach-requested flag. */
  onProposalRowChange: (proposalRowId: string) => void
  proposals: VendorProposal[]
  onUsageImport: ImportHandler
  onPriceImport: ImportHandler
}

export function DealInputsHeader({
  embedded,
  inheritInputs,
  inheritedFacilityName,
  usageLoadedCount,
  priceLoadedCount,
  actualsSyncMode,
  facilityId,
  setFacilityId,
  facilities,
  contractVariant,
  setContractVariant,
  proposalRowId,
  onProposalRowChange,
  proposals,
  onUsageImport,
  onPriceImport,
}: DealInputsHeaderProps) {
  return (
    <>
      {inheritInputs ? (
        // One-page flow: facility + usage + pricing + categories were
        // entered in the proposal above and carry over — show a compact
        // inherited summary, don't re-ask (Charles 2026-07-06).
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {inheritedFacilityName || usageLoadedCount > 0
              ? "From your proposal:"
              : "Facility, usage & pricing come from the proposal above."}
          </span>
          {inheritedFacilityName ? (
            <span className="font-medium">{inheritedFacilityName}</span>
          ) : null}
          {usageLoadedCount > 0 ? (
            <span className="text-muted-foreground">
              · usage {usageLoadedCount} products
            </span>
          ) : null}
          {priceLoadedCount > 0 ? (
            <span className="text-muted-foreground">
              · pricing {priceLoadedCount} products
            </span>
          ) : null}
          {actualsSyncMode === "two_way" ? (
            <Badge
              variant="outline"
              className="text-xs font-normal text-emerald-600 dark:text-emerald-400"
            >
              Synced from facility actuals (two-way)
            </Badge>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "grid gap-4 md:grid-cols-2",
          inheritInputs && "md:grid-cols-1",
        )}
      >
        {!inheritInputs ? (
        <div className="space-y-2">
          <Label htmlFor="facility">Facility</Label>
          <Select value={facilityId} onValueChange={setFacilityId}>
            <SelectTrigger id="facility">
              <SelectValue placeholder="Select a facility..." />
            </SelectTrigger>
            <SelectContent>
              {facilities.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {facilities.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No facilities related to your organization yet — facilities
              appear here once you have a contract, sales history, or
              submitted proposal with them.
            </p>
          )}
          {actualsSyncMode === "two_way" && (
            <Badge
              variant="outline"
              className="text-xs font-normal text-emerald-600 dark:text-emerald-400"
            >
              Synced from facility actuals (two-way)
            </Badge>
          )}
          {actualsSyncMode === "one_way" && (
            <Badge
              variant="outline"
              className="text-xs font-normal text-muted-foreground"
            >
              Manual mode (one-way)
            </Badge>
          )}
        </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="variant">Contract variant</Label>
          <Select
            value={contractVariant}
            onValueChange={(v) => setContractVariant(v as VendorContractVariant)}
          >
            <SelectTrigger id="variant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USAGE_SPEND">Usage — Spend</SelectItem>
              <SelectItem value="USAGE_VOLUME">Usage — Volume</SelectItem>
              <SelectItem value="USAGE_MARKET_SHARE">Usage — Market Share</SelectItem>
              <SelectItem value="CAPITAL_OUTRIGHT">Capital — Outright</SelectItem>
              <SelectItem value="CAPITAL_LEASE">Capital — Lease</SelectItem>
              <SelectItem value="CAPITAL_TIE_IN">Capital — Tie-in</SelectItem>
              <SelectItem value="SERVICE_FIXED">Service — Fixed</SelectItem>
              <SelectItem value="SERVICE_VARIABLE">Service — Variable</SelectItem>
              <SelectItem value="GPO">GPO</SelectItem>
              <SelectItem value="PRICING_ONLY">Pricing only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* The proposal picker renders in BOTH modes (Charles 2026-07-27
          "you can go back and look at it again"). Behind the one-page
          inherit gate it was unreachable, so the only way to attach was a
          save made in the current session — a saved proposal could never
          be picked back up, and its score / constructs / assumptions never
          came back. */}
      <div className="space-y-2">
        <Label htmlFor="attach-proposal">
          {embedded
            ? "Working on proposal"
            : "Attach score to proposal (optional)"}
        </Label>
        <Select value={proposalRowId} onValueChange={onProposalRowChange}>
          <SelectTrigger id="attach-proposal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROPOSAL}>
              Don&apos;t attach — just analyze
            </SelectItem>
            {proposals.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {/* Created date leads so near-identical proposals (Charles
                    saved five copies while testing) stay tellable-apart;
                    the user-chosen name (when set) replaces the bare #id. */}
                {new Date(p.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}{" "}
                · {p.name || `#${p.id.slice(0, 8)}`} — {p.itemCount} items,{" "}
                {formatCurrency(p.totalProposedCost)}
                {p.dealScore ? ` (scored ${p.dealScore.overall})` : ""}
                {p.stage === "analyzed" ? " · analyzed" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {embedded
            ? "Pick a saved proposal to carry on with it — its usage, pricing, constructs and assumptions load straight back in. Left unattached, Analyze saves the proposal you are building above and scores that."
            : "The overall score is saved on the selected proposal and shown on its card in My Proposals."}
        </p>
      </div>

      {!inheritInputs ? (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Label className="text-sm">
            Usage history{" "}
            {usageLoadedCount > 0 && (
              <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">
                · {usageLoadedCount} products
              </span>
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            The 12-month volume each construct is compared against. Fills a
            construct&rsquo;s Volume when you pick its benchmark. Does not
            create constructs.
          </p>
          <PricingFileDropzone
            specs={BUILDER_USAGE_UPLOAD_SPECS}
            surface="vendor-deal-scorer-usage"
            accept=".csv,.txt,.xlsx,.xls"
            onImport={onUsageImport}
            triggerLabel="Upload usage history"
            triggerHint="drop or click (.csv, .txt, .xlsx, .xls)"
          />
        </div>

        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Label className="text-sm">
            Current price file{" "}
            {priceLoadedCount > 0 && (
              <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">
                · {priceLoadedCount} products
              </span>
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            The price the facility pays today. Fills a construct&rsquo;s
            Current price when you pick its benchmark.
          </p>
          <PricingFileDropzone
            specs={BUILDER_PRICING_UPLOAD_SPECS}
            surface="vendor-deal-scorer-price"
            accept=".csv,.txt,.xlsx,.xls"
            onImport={onPriceImport}
            triggerLabel="Upload current prices"
            triggerHint="drop or click (.csv, .txt, .xlsx, .xls)"
          />
        </div>
      </div>
      ) : null}
    </>
  )
}

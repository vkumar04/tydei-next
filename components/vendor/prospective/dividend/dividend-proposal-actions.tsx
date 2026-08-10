"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Save,
  FolderOpen,
  Download,
  Trash2,
  FileText,
  Sheet,
  Check,
  Loader2,
} from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { getDividendProposal } from "@/lib/actions/dividend-proposals"
import type {
  DividendProposalListItem,
  SavedDividendProposal,
} from "@/lib/actions/dividend-proposals"
import type { DividendProposalPayload } from "@/lib/validators/dividend-proposals"
import type { DividendVerdict } from "@/lib/financial-analysis/proforma-pnl"
import {
  useDividendProposals,
  useSaveDividendProposal,
  useDeleteDividendProposal,
} from "@/hooks/use-dividend"
import { GOOD_TONE, BAD_TONE } from "./primitives"
import {
  exportDividendReportHtml,
  exportDividendReportCsv,
  type DividendReportContext,
} from "./report-export"

export interface DividendProposalSnapshot {
  facilityKey: string | null
  facilityLabel: string
  payload: DividendProposalPayload
  summary: {
    verdict: DividendVerdict
    noiImpact: number
    annualDividendImpact: number
    netPresentValue: number
    paybackYears: number | null
  }
}

/** Save / load / export controls for the Dividend/DCF tab header. */
export function DividendProposalActions({
  vendorId,
  snapshot,
  report,
  currentId,
  currentName,
  onLoad,
  onSaved,
  onDeleted,
}: {
  vendorId: string
  /** Everything needed to persist the current proposal (minus id/name). */
  snapshot: DividendProposalSnapshot
  /** Everything needed to render an export (includes computed impact). */
  report: Omit<DividendReportContext, "proposalName">
  currentId: string | null
  currentName: string | null
  onLoad: (proposal: SavedDividendProposal) => void
  onSaved: (proposal: DividendProposalListItem) => void
  /** Fired after a delete so the parent can drop a dangling currentId. */
  onDeleted: (id: string) => void
}) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [name, setName] = useState("")
  const [openingId, setOpeningId] = useState<string | null>(null)

  const { data: proposals = [] } = useDividendProposals(vendorId)
  const saveMutation = useSaveDividendProposal()
  const deleteMutation = useDeleteDividendProposal()

  const openSaveDialog = () => {
    setName(currentName ?? report.purchase.productName ?? "New proposal")
    setSaveOpen(true)
  }

  const handleSave = (asNew: boolean) => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Give the proposal a name")
      return
    }
    saveMutation.mutate(
      {
        ...snapshot,
        name: trimmed,
        id: asNew ? undefined : (currentId ?? undefined),
      },
      {
        onSuccess: (saved) => {
          onSaved(saved)
          setSaveOpen(false)
        },
      },
    )
  }

  const handleOpen = async (id: string) => {
    setOpeningId(id)
    try {
      const full = await getDividendProposal(id)
      if (!full) {
        toast.error("This proposal could not be loaded")
        return
      }
      onLoad(full)
      setManageOpen(false)
      toast.success(`Loaded “${full.name}”`)
    } catch {
      toast.error("This proposal could not be loaded")
    } finally {
      setOpeningId(null)
    }
  }

  const verdictTone = (v: DividendProposalListItem["verdict"]) =>
    v === "accretive"
      ? `border-emerald-600/40 ${GOOD_TONE}`
      : v === "dilutive"
        ? `border-red-600/40 ${BAD_TONE}`
        : ""

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="default" className="gap-2" onClick={openSaveDialog}>
        <Save className="h-4 w-4" />
        {currentId ? "Save" : "Save proposal"}
      </Button>

      <Button
        size="sm"
        variant="outline"
        className="gap-2"
        onClick={() => setManageOpen(true)}
      >
        <FolderOpen className="h-4 w-4" />
        Saved
        {proposals.length > 0 ? (
          <Badge variant="secondary" className="ml-1 px-1.5">
            {proposals.length}
          </Badge>
        ) : null}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export report
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() =>
              exportDividendReportHtml({
                ...report,
                proposalName: currentName ?? report.purchase.productName,
              })
            }
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            Formatted report (HTML / print to PDF)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              exportDividendReportCsv({
                ...report,
                proposalName: currentName ?? report.purchase.productName,
              })
            }
            className="gap-2"
          >
            <Sheet className="h-4 w-4" />
            Data export (CSV)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {currentId ? "Save proposal" : "Save new proposal"}
            </DialogTitle>
            <DialogDescription>
              Saves the full scenario — facility P&amp;L, purchase, selected
              procedure groups, quarter edits, and reimbursement basis — so you
              can reopen it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label
              htmlFor="dividend-proposal-name"
              className="text-xs text-muted-foreground"
            >
              Proposal name
            </Label>
            <Input
              id="dividend-proposal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme knee system — Q3 proposal"
              autoFocus
              onKeyDown={(e) => {
                // isPending guard: a held Enter must not double-submit and
                // mint duplicate proposals.
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  !saveMutation.isPending
                )
                  handleSave(false)
              }}
            />
            <span className="text-[11px] text-muted-foreground">
              Facility: {report.facilityLabel}
            </span>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {currentId ? (
              <Button
                variant="outline"
                disabled={saveMutation.isPending}
                onClick={() => handleSave(true)}
              >
                Save as new
              </Button>
            ) : (
              <span />
            )}
            <Button
              onClick={() => handleSave(false)}
              disabled={saveMutation.isPending}
              className="gap-2"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {currentId ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage / load dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Saved proposals</DialogTitle>
            <DialogDescription>
              Reopen a proposal to restore its full scenario.
            </DialogDescription>
          </DialogHeader>
          {proposals.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No saved proposals yet. Build a scenario and click &ldquo;Save
              proposal&rdquo;.
            </div>
          ) : (
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="flex flex-col gap-2">
                {proposals.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-3 rounded-md border p-3 ${
                      p.id === currentId
                        ? "border-emerald-600/50 bg-emerald-600/5"
                        : "border-border"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {p.name}
                        </span>
                        {p.verdict ? (
                          <Badge
                            variant="outline"
                            className={`shrink-0 ${verdictTone(p.verdict)}`}
                          >
                            {p.verdict}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {p.facilityLabel} · Dividend{" "}
                        {(p.annualDividendImpact ?? 0) >= 0 ? "+" : ""}
                        {formatCurrency(p.annualDividendImpact ?? 0)} · NPV{" "}
                        {formatCurrency(p.netPresentValue ?? 0)} ·{" "}
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={openingId === p.id}
                        onClick={() => handleOpen(p.id)}
                      >
                        {openingId === p.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Open"
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-red-600"
                        aria-label={`Delete ${p.name}`}
                        onClick={() =>
                          deleteMutation.mutate(p.id, {
                            onSuccess: () => onDeleted(p.id),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

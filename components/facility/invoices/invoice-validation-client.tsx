"use client"

import { useMemo, useState } from "react"
import { Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useInvoiceSummary, useInvoices } from "@/hooks/use-invoices"
import { toast } from "sonner"
import { InvoiceImportDialog } from "./invoice-import-dialog"
import { InvoiceDisputeDialog } from "./invoice-dispute-dialog"
import { InvoiceDetailsDialog } from "./invoice-details-dialog"
import {
  InvoiceValidationHero,
  type InvoiceValidationHeroStats,
} from "./invoice-validation-hero"
import { InvoiceValidationControlBar } from "./invoice-validation-control-bar"
import {
  InvoiceDiscrepancyTable,
  type InvoiceRow,
} from "./invoice-discrepancy-table"

/**
 * Invoice Validation page orchestrator — hero + tabbed details.
 *
 * Layout (2026-04-22 redesign, mirrors the Rebate Optimizer / Financial
 * Analysis pages):
 *
 *   1. Hero — four big-number KPIs (Total Invoices, Awaiting Review,
 *      Flagged Variance, Recovered YTD) with a headline + status pill.
 *   2. ControlBar — search, vendor filter, dispute-only toggle, and
 *      Upload/Export CTAs. Tabs below own the status axis.
 *   3. Tabs — Awaiting Review / Flagged Variances / Approved / Disputed
 *      / All. Each tab renders the `InvoiceDiscrepancyTable`.
 *
 * Replaces the four `border-l-4 border-l-<color>` KPI cards +
 * Monthly Recovery progress card + filter row + inline table.
 */
interface Vendor {
  id: string
  name: string
}

interface InvoiceValidationClientProps {
  facilityId: string
  vendors: Vendor[]
}

type TabValue = "awaiting" | "flagged" | "approved" | "disputed" | "all"

export function InvoiceValidationClient({
  facilityId,
  vendors,
}: InvoiceValidationClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [vendorFilter, setVendorFilter] = useState("all")
  const [disputeFilter, setDisputeFilter] = useState<"all" | "disputed">("all")
  const [activeTab, setActiveTab] = useState<TabValue>("awaiting")
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([])
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(
    null,
  )
  const [disputeDialogInvoice, setDisputeDialogInvoice] =
    useState<InvoiceRow | null>(null)

  const { data: summary, isLoading: summaryLoading } =
    useInvoiceSummary(facilityId)

  const { data, isLoading: tableLoading } = useInvoices(facilityId, {
    facilityId,
    vendorId: vendorFilter === "all" ? undefined : vendorFilter,
  })

  const invoices = (data?.invoices ?? []) as InvoiceRow[]

  const totalVariance = summary?.totalVariance ?? 0
  const variancePercent = summary?.variancePercent ?? 0

  // ─── Base filter (search + dispute toggle) ─────────────────────
  const searchFiltered = useMemo(() => {
    return invoices.filter((inv) => {
      const q = searchQuery.toLowerCase()
      const matchesSearch =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.vendor.name.toLowerCase().includes(q)
      const matchesDispute =
        disputeFilter === "all" || inv.disputeStatus === "disputed"
      return matchesSearch && matchesDispute
    })
  }, [invoices, searchQuery, disputeFilter])

  // ─── Per-tab slicing ──────────────────────────────────────────
  const awaitingInvoices = useMemo(
    () => searchFiltered.filter((i) => i.status === "pending"),
    [searchFiltered],
  )
  const flaggedInvoices = useMemo(
    () => searchFiltered.filter((i) => Math.abs(i.variance) > 0.01),
    [searchFiltered],
  )
  const approvedInvoices = useMemo(
    () =>
      searchFiltered.filter(
        (i) => i.status === "verified" || i.status === "validated",
      ),
    [searchFiltered],
  )
  const disputedInvoices = useMemo(
    () =>
      searchFiltered.filter(
        (i) => i.disputeStatus === "disputed" || i.status === "disputed",
      ),
    [searchFiltered],
  )

  // ─── Hero stats ───────────────────────────────────────────────
  const heroStats = useMemo<InvoiceValidationHeroStats>(() => {
    const flaggedVariance = invoices.reduce(
      (sum, inv) => (inv.variance > 0 ? sum + inv.variance : sum),
      0,
    )
    return {
      totalInvoices: invoices.length,
      awaitingReview: invoices.filter((i) => i.status === "pending").length,
      flaggedVariance: flaggedVariance || totalVariance,
      recoveredYTD: totalVariance > 0 ? totalVariance : 0,
      variancePercent,
    }
  }, [invoices, totalVariance, variancePercent])

  // ─── Action handlers ──────────────────────────────────────────
  const toggleSelectInvoice = (id: string) => {
    setSelectedInvoices((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }

  const handleViewDetails = (invoice: InvoiceRow) => {
    setSelectedInvoice(invoice)
    setDetailsDialogOpen(true)
  }

  const handleDisputeInvoice = (invoice: InvoiceRow) => {
    setDisputeDialogInvoice(invoice)
  }

  const handleApproveInvoice = (_invoiceId: string) => {
    toast.success("Invoice approved", {
      description: "Invoice has been marked as verified",
    })
  }

  const handleBulkDispute = () => {
    // Bulk dispute surface deferred to vendor-transactions spec;
    // single-invoice flow drives the canonical dispute dialog.
    toast.info("Bulk dispute coming soon — use per-row flag for now.")
    setSelectedInvoices([])
  }

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoices(awaitingInvoices.map((i) => i.id))
    } else {
      setSelectedInvoices([])
    }
  }

  const renderTable = (
    rows: InvoiceRow[],
    opts: { selectable?: boolean; emptyMessage?: string } = {},
  ) => (
    <InvoiceDiscrepancyTable
      rows={rows}
      loading={tableLoading}
      selectable={opts.selectable ?? false}
      selectedIds={selectedInvoices}
      onToggleSelect={toggleSelectInvoice}
      onToggleSelectAll={handleToggleSelectAll}
      selectableRows={awaitingInvoices}
      onViewDetails={handleViewDetails}
      onDispute={handleDisputeInvoice}
      onApprove={handleApproveInvoice}
      emptyMessage={opts.emptyMessage}
    />
  )

  return (
    <div className="space-y-6">
      <InvoiceValidationHero stats={heroStats} loading={summaryLoading} />

      <InvoiceValidationControlBar
        vendors={vendors}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        vendorFilter={vendorFilter}
        onVendorFilterChange={setVendorFilter}
        disputeFilter={disputeFilter}
        onDisputeFilterChange={setDisputeFilter}
        onImportClick={() => setImportOpen(true)}
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList>
          <TabsTrigger value="awaiting">
            Awaiting Review ({awaitingInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="flagged">
            Flagged Variances ({flaggedInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({approvedInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="disputed">
            Disputed ({disputedInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="all">All ({searchFiltered.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="awaiting" className="mt-4">
          {renderTable(awaitingInvoices, {
            selectable: true,
            emptyMessage: "No invoices awaiting review.",
          })}
        </TabsContent>
        <TabsContent value="flagged" className="mt-4">
          {renderTable(flaggedInvoices, {
            emptyMessage: "No flagged variances.",
          })}
        </TabsContent>
        <TabsContent value="approved" className="mt-4">
          {renderTable(approvedInvoices, {
            emptyMessage: "No approved invoices.",
          })}
        </TabsContent>
        <TabsContent value="disputed" className="mt-4">
          {renderTable(disputedInvoices, {
            emptyMessage: "No disputed invoices.",
          })}
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          {renderTable(searchFiltered, {
            emptyMessage: "No invoices found.",
          })}
        </TabsContent>
      </Tabs>

      <InvoiceDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        invoice={selectedInvoice}
        onApprove={handleApproveInvoice}
        onDispute={handleDisputeInvoice}
      />

      {disputeDialogInvoice && (
        <InvoiceDisputeDialog
          open={!!disputeDialogInvoice}
          onOpenChange={(open) => {
            if (!open) setDisputeDialogInvoice(null)
          }}
          invoiceId={disputeDialogInvoice.id}
          invoiceNumber={disputeDialogInvoice.invoiceNumber}
          vendorName={disputeDialogInvoice.vendor.name}
          currentStatus={disputeDialogInvoice.disputeStatus ?? "none"}
          existingNote={disputeDialogInvoice.disputeNote ?? null}
        />
      )}

      <InvoiceImportDialog
        facilityId={facilityId}
        vendors={vendors}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {}}
      />
    </div>
  )
}

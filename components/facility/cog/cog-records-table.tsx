"use client"

import { useState, useMemo } from "react"
import { Plus, Download, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { useCOGRecords, useDeleteCOGRecord, useUpdateCOGRecord } from "@/hooks/use-cog"
import { useVendorList } from "@/hooks/use-vendor-crud"
import {
  getCOGColumns,
  MATCH_STATUS_META,
} from "@/components/facility/cog/cog-columns"
import { COGManualEntry } from "@/components/facility/cog/cog-manual-entry"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty"
import { FileText, AlertTriangle } from "lucide-react"
import type { COGRecord, COGMatchStatus } from "@prisma/client"

type COGRecordWithVendor = COGRecord & {
  vendor: { id: string; name: string } | null
}

interface COGRecordsTableProps {
  facilityId: string
  dateFrom?: string
  dateTo?: string
  /**
   * Optional re-run-match handler + pending flag, passed down from
   * COGDataClient so the "On Contract shows 0" empty-state banner can
   * offer a one-click CTA without the user scroll-finding the header
   * "Match Pricing" button. See Charles R5.30.
   */
  onRerunMatch?: () => void
  isRerunning?: boolean
  /** Total record count used in the "Running matcher on N records…" copy. */
  totalRecords?: number
}

type MatchFilterValue = COGMatchStatus | "all" | "variance_only"

const MATCH_FILTER_OPTIONS: readonly {
  value: MatchFilterValue
  label: string
}[] = [
  { value: "all", label: "All match statuses" },
  { value: "variance_only", label: "Variance only (off + variance)" },
  { value: "on_contract", label: MATCH_STATUS_META.on_contract.label },
  { value: "off_contract_item", label: MATCH_STATUS_META.off_contract_item.label },
  { value: "price_variance", label: MATCH_STATUS_META.price_variance.label },
  { value: "out_of_scope", label: MATCH_STATUS_META.out_of_scope.label },
  { value: "unknown_vendor", label: MATCH_STATUS_META.unknown_vendor.label },
  { value: "pending", label: MATCH_STATUS_META.pending.label },
] as const

export function COGRecordsTable({
  facilityId,
  dateFrom,
  dateTo,
  onRerunMatch,
  isRerunning,
  totalRecords,
}: COGRecordsTableProps) {
  const [vendorFilter, setVendorFilter] = useState<string>("")
  const [matchFilter, setMatchFilter] = useState<MatchFilterValue>("all")
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [manualOpen, setManualOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<COGRecordWithVendor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    desc: string
  } | null>(null)
  const [exporting, setExporting] = useState(false)

  const filters = {
    ...(vendorFilter && vendorFilter !== "all" && { vendorId: vendorFilter }),
    ...(matchFilter !== "all" && { matchStatus: matchFilter }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    page,
    pageSize,
  }
  const { data, isLoading, refetch } = useCOGRecords(facilityId, filters)
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const { data: vendorData } = useVendorList()
  const deleteMutation = useDeleteCOGRecord()
  const updateMutation = useUpdateCOGRecord()

  const editForm = useForm({
    defaultValues: {
      inventoryNumber: "",
      inventoryDescription: "",
      unitCost: 0,
      quantity: 1,
      vendorName: "",
      vendorItemNo: "",
      notes: "",
    },
  })

  const columns = useMemo(
    () =>
      getCOGColumns({
        onDelete: (r) =>
          setDeleteTarget({ id: r.id, desc: r.inventoryDescription }),
        onEdit: (r) => {
          setEditTarget(r)
          editForm.reset({
            inventoryNumber: r.inventoryNumber,
            inventoryDescription: r.inventoryDescription,
            unitCost: Number(r.unitCost),
            quantity: (r as COGRecordWithVendor & { quantity?: number }).quantity ?? 1,
            vendorName: r.vendorName ?? "",
            vendorItemNo: r.vendorItemNo ?? "",
            notes: r.notes ?? "",
          })
        },
      }),
    [editForm]
  )

  // Filtering is now server-side via the `where` clause in
  // getCOGRecords — the query below returns only the filtered slice
  // for the current page and `total` reflects the filtered count.
  const filteredRecords = data?.records ?? []

  const hasAnyRecords = filteredRecords.length > 0
  const hasFilters =
    !!vendorFilter && vendorFilter !== "all"
      ? true
      : matchFilter !== "all" || !!dateFrom || !!dateTo

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.set("facilityId", facilityId)
      if (vendorFilter && vendorFilter !== "all")
        params.set("vendorId", vendorFilter)
      if (dateFrom) params.set("dateFrom", dateFrom)
      if (dateTo) params.set("dateTo", dateTo)
      if (matchFilter !== "all") params.set("matchStatus", matchFilter)

      const res = await fetch(`/api/cog/export?${params.toString()}`, {
        method: "GET",
      })
      if (!res.ok) {
        throw new Error(`Export failed: ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `cog-data-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success("Export downloaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {!isLoading && !hasAnyRecords && !hasFilters ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No COG records yet</EmptyTitle>
            <EmptyDescription>
              Upload your first COG file to start matching contract pricing
              and surfacing savings opportunities.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DataTable
          columns={columns}
          data={filteredRecords}
          searchKey="inventoryDescription"
          searchPlaceholder="Search by description, vendor item, or inventory number..."
          isLoading={isLoading}
          pagination={false}
          filterComponent={
            <>
              <Select
                value={vendorFilter || "all"}
                onValueChange={(v) => {
                  // Filter changes reset to page 1 so the user sees
                  // the first page of the new filtered result set
                  // rather than a potentially-empty page N.
                  setPage(1)
                  setVendorFilter(v === "all" ? "" : v)
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  {vendorData?.vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={matchFilter}
                onValueChange={(v) => {
                  setPage(1)
                  setMatchFilter(v as MatchFilterValue)
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {matchFilter !== "all" && (
                <Badge variant="outline" className="shrink-0">
                  {total.toLocaleString()} filtered
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setManualOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Add Record
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                Export
              </Button>
            </>
          }
        />
      )}

      {!isLoading && hasFilters && filteredRecords.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
            {matchFilter === "on_contract" ? (
              // Charles R5.11 — the "On Contract" filter showing 0 results
              // is almost always because no ContractPricing rows have been
              // uploaded yet. Point the user at the concrete remediation
              // rather than a generic "adjust your filters".
              // Charles R5.30 — add an inline primary CTA so the user
              // doesn't have to scroll up to find the header button.
              <>
                <p className="font-medium">No COG items are matched to a contract yet.</p>
                <p>
                  Upload pricing files to your active contracts (Pricing
                  tab on each contract detail), then click <b>Run Match
                  Pricing</b> below to run the matcher. Items whose vendor
                  has a contract but whose SKU isn&apos;t on any pricing
                  file will show as <b>Not Priced</b> — that&apos;s the
                  same underlying signal.
                </p>
                {onRerunMatch && (
                  <div className="pt-2">
                    {isRerunning ? (
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>
                          Running matcher
                          {typeof totalRecords === "number" && totalRecords > 0
                            ? ` on ${totalRecords.toLocaleString()} records`
                            : ""}
                          {" "}(this may take a minute)…
                        </span>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={onRerunMatch}
                        disabled={isRerunning}
                      >
                        Run Match Pricing
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p>
                No records match the current filters. Adjust your filters
                to see more data.
              </p>
            )}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()} records
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <COGManualEntry
        facilityId={facilityId}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onComplete={() => refetch()}
      />

      {/* Edit Dialog */}
      <FormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Edit COG Record"
        description="Update the details of this COG record"
        onSubmit={editForm.handleSubmit(async (values) => {
          if (!editTarget) return
          await updateMutation.mutateAsync({
            id: editTarget.id,
            data: values,
          })
          setEditTarget(null)
        })}
        isSubmitting={updateMutation.isPending}
        submitLabel="Save"
      >
        <Field label="Inventory Number">
          <Input {...editForm.register("inventoryNumber")} />
        </Field>
        <Field label="Description">
          <Input {...editForm.register("inventoryDescription")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit Cost">
            <Input type="number" step="0.01" {...editForm.register("unitCost", { valueAsNumber: true })} />
          </Field>
          <Field label="Quantity">
            <Input type="number" {...editForm.register("quantity", { valueAsNumber: true })} />
          </Field>
        </div>
        <Field label="Vendor Name">
          <Input {...editForm.register("vendorName")} />
        </Field>
        <Field label="Vendor Item No">
          <Input {...editForm.register("vendorItemNo")} />
        </Field>
        <Field label="Notes">
          <Textarea rows={3} {...editForm.register("notes")} />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Record"
        description={`Delete "${deleteTarget?.desc}"? This cannot be undone.`}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMutation.mutateAsync(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        isLoading={deleteMutation.isPending}
        variant="destructive"
      />
    </div>
  )
}

"use client"

import { useState, useMemo } from "react"
import { Plus, Download, ChevronLeft, ChevronRight } from "lucide-react"
import { useForm } from "react-hook-form"
import { useCOGRecords, useDeleteCOGRecord, useUpdateCOGRecord } from "@/hooks/use-cog"
import { useVendorList } from "@/hooks/use-vendor-crud"
import { getCOGColumns } from "@/components/facility/cog/cog-columns"
import { COGManualEntry } from "@/components/facility/cog/cog-manual-entry"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { COGRecord } from "@prisma/client"

type COGRecordWithVendor = COGRecord & {
  vendor: { id: string; name: string } | null
}

interface COGRecordsTableProps {
  facilityId: string
  dateFrom?: string
  dateTo?: string
}

export function COGRecordsTable({ facilityId, dateFrom, dateTo }: COGRecordsTableProps) {
  const [vendorFilter, setVendorFilter] = useState<string>("")
  const [contractFilter, setContractFilter] = useState<string>("all")
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [manualOpen, setManualOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<COGRecordWithVendor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    desc: string
  } | null>(null)

  const filters = {
    ...(vendorFilter && { vendorId: vendorFilter }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    page,
    pageSize,
  }
  const { data, isLoading, refetch } = useCOGRecords(facilityId, filters)
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)
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
          })
        },
      }),
    [editForm]
  )

  // Filter by contract status client-side
  const filteredRecords = useMemo(() => {
    const records = data?.records ?? []
    if (contractFilter === "all") return records
    if (contractFilter === "on") return records.filter((r) => r.category && r.category !== "")
    if (contractFilter === "off") return records.filter((r) => !r.category || r.category === "")
    return records
  }, [data, contractFilter])

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={filteredRecords}
        searchKey="inventoryDescription"
        searchPlaceholder="Search by description, vendor item, or inventory number..."
        isLoading={isLoading}
        pagination={false}
        filterComponent={
          <>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
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
            <Select value={contractFilter} onValueChange={setContractFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items</SelectItem>
                <SelectItem value="on">On Contract</SelectItem>
                <SelectItem value="off">Off Contract</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setManualOpen(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add Record
            </Button>
            <Button variant="outline" size="icon">
              <Download className="h-4 w-4" />
            </Button>
          </>
        }
      />

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

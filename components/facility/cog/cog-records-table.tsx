"use client"

import { useState, useMemo } from "react"
import { Plus, Upload } from "lucide-react"
import { useCOGRecords, useDeleteCOGRecord } from "@/hooks/use-cog"
import { useVendorList } from "@/hooks/use-vendor-crud"
import { getCOGColumns } from "@/components/facility/cog/cog-columns"
import { COGImportDialog } from "@/components/facility/cog/cog-import-dialog"
import { COGManualEntry } from "@/components/facility/cog/cog-manual-entry"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface COGRecordsTableProps {
  facilityId: string
}

export function COGRecordsTable({ facilityId }: COGRecordsTableProps) {
  const [vendorFilter, setVendorFilter] = useState<string>("")
  const [importOpen, setImportOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; desc: string } | null>(null)

  const filters = { ...(vendorFilter && { vendorId: vendorFilter }) }
  const { data, isLoading, refetch } = useCOGRecords(facilityId, filters)
  const { data: vendorData } = useVendorList()
  const deleteMutation = useDeleteCOGRecord()

  const columns = useMemo(
    () =>
      getCOGColumns({
        onDelete: (r) =>
          setDeleteTarget({ id: r.id, desc: r.inventoryDescription }),
      }),
    []
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="size-4" /> Import
        </Button>
        <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
          <Plus className="size-4" /> Add Record
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.records ?? []}
        searchKey="inventoryDescription"
        searchPlaceholder="Search COG records..."
        isLoading={isLoading}
        filterComponent={
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
        }
      />

      <COGImportDialog
        facilityId={facilityId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => refetch()}
      />

      <COGManualEntry
        facilityId={facilityId}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onComplete={() => refetch()}
      />

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

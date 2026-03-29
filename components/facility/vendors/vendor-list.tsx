"use client"

import { useState, useMemo } from "react"
import { Plus } from "lucide-react"
import type { Vendor } from "@prisma/client"
import { useVendorList, useDeactivateVendor } from "@/hooks/use-vendor-crud"
import { getVendorColumns } from "@/components/facility/vendors/vendor-columns"
import { VendorFormDialog } from "@/components/facility/vendors/vendor-form-dialog"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { Button } from "@/components/ui/button"

export function VendorList() {
  const [formOpen, setFormOpen] = useState(false)
  const [editVendor, setEditVendor] = useState<Vendor | undefined>()
  const [deactivateTarget, setDeactivateTarget] = useState<Vendor | null>(null)

  const { data, isLoading, refetch } = useVendorList()
  const deactivateMutation = useDeactivateVendor()

  const columns = useMemo(
    () =>
      getVendorColumns({
        onEdit: (v) => {
          setEditVendor(v)
          setFormOpen(true)
        },
        onDeactivate: (v) => setDeactivateTarget(v),
      }),
    []
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            setEditVendor(undefined)
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" /> Add Vendor
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.vendors ?? []}
        searchKey="name"
        searchPlaceholder="Search vendors..."
        isLoading={isLoading}
      />

      <VendorFormDialog
        vendor={editVendor}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditVendor(undefined)
        }}
        onComplete={() => refetch()}
      />

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        title="Deactivate Vendor"
        description={`Deactivate "${deactivateTarget?.name}"? The vendor will no longer appear in active lists.`}
        onConfirm={async () => {
          if (deactivateTarget) {
            await deactivateMutation.mutateAsync(deactivateTarget.id)
            setDeactivateTarget(null)
          }
        }}
        isLoading={deactivateMutation.isPending}
        variant="destructive"
      />
    </div>
  )
}

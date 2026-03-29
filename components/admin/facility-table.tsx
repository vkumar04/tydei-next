"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { getFacilityColumns } from "./facility-columns"
import { FacilityFormDialog } from "./facility-form-dialog"
import {
  adminGetFacilities,
  adminCreateFacility,
  adminUpdateFacility,
  adminDeleteFacility,
  type AdminFacilityRow,
} from "@/lib/actions/admin/facilities"
import type { AdminCreateFacilityInput } from "@/lib/validators/admin"
import { queryKeys } from "@/lib/query-keys"

export function FacilityTable() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminFacilityRow | null>(null)
  const [deleting, setDeleting] = useState<AdminFacilityRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.facilities(),
    queryFn: () => adminGetFacilities({}),
  })

  const createMut = useMutation({
    mutationFn: (input: AdminCreateFacilityInput) => adminCreateFacility(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.facilities() }); setFormOpen(false); toast.success("Facility created") },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminCreateFacilityInput }) => adminUpdateFacility(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.facilities() }); setEditing(null); toast.success("Facility updated") },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFacility(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.facilities() }); setDeleting(null); toast.success("Facility deleted") },
  })

  const columns = getFacilityColumns(
    (f) => setEditing(f),
    (f) => setDeleting(f)
  )

  return (
    <>
      <DataTable
        columns={columns}
        data={data?.facilities ?? []}
        searchKey="name"
        searchPlaceholder="Search facilities..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" /> Add Facility
          </Button>
        }
      />
      <FacilityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={async (d) => { await createMut.mutateAsync(d) }}
        isSubmitting={createMut.isPending}
      />
      {editing && (
        <FacilityFormDialog
          facility={{ id: editing.id, name: editing.name, type: editing.type as AdminCreateFacilityInput["type"], status: editing.status }}
          open={!!editing}
          onOpenChange={() => setEditing(null)}
          onSubmit={async (d) => { await updateMut.mutateAsync({ id: editing.id, input: d }) }}
          isSubmitting={updateMut.isPending}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Facility"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        onConfirm={async () => { if (deleting) await deleteMut.mutateAsync(deleting.id) }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

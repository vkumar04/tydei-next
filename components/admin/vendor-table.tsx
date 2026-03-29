"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { getAdminVendorColumns } from "./vendor-columns"
import {
  adminGetVendors,
  adminCreateVendor,
  adminUpdateVendor,
  adminDeleteVendor,
  type AdminVendorRow,
} from "@/lib/actions/admin/vendors"
import type { AdminCreateVendorInput } from "@/lib/validators/admin"
import { queryKeys } from "@/lib/query-keys"

export function VendorTable() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminVendorRow | null>(null)
  const [deleting, setDeleting] = useState<AdminVendorRow | null>(null)
  const [formData, setFormData] = useState<Partial<AdminCreateVendorInput>>({})

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.vendors(),
    queryFn: () => adminGetVendors({}),
  })

  const createMut = useMutation({
    mutationFn: (input: AdminCreateVendorInput) => adminCreateVendor(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.vendors() }); setFormOpen(false); toast.success("Vendor created") },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminCreateVendorInput }) => adminUpdateVendor(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.vendors() }); setEditing(null); toast.success("Vendor updated") },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteVendor(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.vendors() }); setDeleting(null); toast.success("Vendor deleted") },
  })

  const columns = getAdminVendorColumns(
    (v) => { setEditing(v); setFormData({ name: v.name, code: v.code ?? "", contactName: v.contactName ?? "", contactEmail: v.contactEmail ?? "" }) },
    (v) => setDeleting(v)
  )

  const handleSubmit = async () => {
    const input = formData as AdminCreateVendorInput
    if (editing) {
      await updateMut.mutateAsync({ id: editing.id, input })
    } else {
      await createMut.mutateAsync(input)
    }
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={data?.vendors ?? []}
        searchKey="name"
        searchPlaceholder="Search vendors..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" onClick={() => { setFormData({}); setFormOpen(true) }}>
            <Plus className="size-4" /> Add Vendor
          </Button>
        }
      />
      <FormDialog
        open={formOpen || !!editing}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setEditing(null) } }}
        title={editing ? "Edit Vendor" : "Create Vendor"}
        onSubmit={handleSubmit}
        isSubmitting={createMut.isPending || updateMut.isPending}
      >
        <Field label="Name" required>
          <Input value={formData.name ?? ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
        </Field>
        <Field label="Code">
          <Input value={formData.code ?? ""} onChange={(e) => setFormData({ ...formData, code: e.target.value })} />
        </Field>
        <Field label="Contact Name">
          <Input value={formData.contactName ?? ""} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} />
        </Field>
        <Field label="Contact Email">
          <Input value={formData.contactEmail ?? ""} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} />
        </Field>
      </FormDialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Vendor"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        onConfirm={async () => { if (deleting) await deleteMut.mutateAsync(deleting.id) }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

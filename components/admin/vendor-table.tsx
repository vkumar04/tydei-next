"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Building2, CheckCircle, Users, FileText, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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

  const vendors = data?.vendors ?? []
  const activeVendors = vendors.filter((v) => v.status === "active")
  const totalContracts = vendors.reduce((sum, v) => sum + v.contractCount, 0)

  return (
    <>
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{vendors.length}</p>
                <p className="text-xs text-muted-foreground">Total Vendors</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-5 w-5 text-green-700 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeVendors.length}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="h-5 w-5 text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{vendors.reduce((sum, v) => sum + (v.contactName ? 1 : 0), 0)}</p>
                <p className="text-xs text-muted-foreground">Sales Reps</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                <FileText className="h-5 w-5 text-purple-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalContracts}</p>
                <p className="text-xs text-muted-foreground">Total Contracts</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={vendors}
        searchKey="name"
        searchPlaceholder="Search vendors..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => { setFormData({}); setFormOpen(true) }}>
            <Plus className="size-4" /> Add Vendor
          </Button>
        }
      />
      <FormDialog
        open={formOpen || !!editing}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setEditing(null) } }}
        title={editing ? "Edit Vendor" : "Add New Vendor"}
        description={editing ? "Modify vendor details" : "Add a new vendor organization to the platform"}
        onSubmit={handleSubmit}
        isSubmitting={createMut.isPending || updateMut.isPending}
      >
        <Field label="Vendor Name" required>
          <Input value={formData.name ?? ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter vendor name" />
        </Field>
        <Field label="Code">
          <Input value={formData.code ?? ""} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., STR" />
        </Field>
        <Field label="Contact Name">
          <Input value={formData.contactName ?? ""} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} placeholder="Primary contact name" />
        </Field>
        <Field label="Contact Email">
          <Input value={formData.contactEmail ?? ""} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} placeholder="admin@vendor.com" />
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

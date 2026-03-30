"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Building2, CheckCircle, Users, FileText, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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

  const facilities = data?.facilities ?? []
  const activeFacilities = facilities.filter((f) => f.status === "active")
  const totalUsers = facilities.reduce((sum, f) => sum + f.userCount, 0)
  const totalContracts = facilities.reduce((sum, f) => sum + f.contractCount, 0)

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
                <p className="text-2xl font-bold">{facilities.length}</p>
                <p className="text-xs text-muted-foreground">Total Facilities</p>
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
                <p className="text-2xl font-bold">{activeFacilities.length}</p>
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
                <p className="text-2xl font-bold">{totalUsers}</p>
                <p className="text-xs text-muted-foreground">Total Users</p>
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
        data={facilities}
        searchKey="name"
        searchPlaceholder="Search facilities..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => setFormOpen(true)}>
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

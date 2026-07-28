"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminFacilityRow | null>(null)
  const [deleting, setDeleting] = useState<AdminFacilityRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.facilities(),
    queryFn: () => adminGetFacilities({}),
  })

  // Charles 2026-06-20: these admin mutations had only onSuccess. A failing
  // server action (validation, duplicate, or a requireAdmin redirect-throw)
  // surfaced as an UNHANDLED rejection — which Next escalates to its error
  // boundary, the "pages time out and switch randomly" symptom. Surface
  // failures as toasts so the operator stays on the page.
  const onMutationError = (verb: string) => (err: unknown) =>
    toast.error(err instanceof Error ? err.message : `Failed to ${verb} facility`)

  const createMut = useMutation({
    mutationFn: (input: AdminCreateFacilityInput) => adminCreateFacility(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.facilities() }); setFormOpen(false); toast.success("Facility created") },
    onError: onMutationError("create"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminCreateFacilityInput }) => adminUpdateFacility(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.facilities() }); setEditing(null); toast.success("Facility updated") },
    onError: onMutationError("update"),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFacility(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.facilities() }); setDeleting(null); toast.success("Facility deleted") },
    onError: onMutationError("delete"),
  })

  const columns = getFacilityColumns(
    (f) => setEditing(f),
    (f) => setDeleting(f),
    // "Manage Users" was a dead no-op; route the operator to user management.
    () => router.push("/admin/users"),
  )

  const facilities = data?.facilities ?? []

  /**
   * EVERY card below reads a server-side total covering all facilities. None
   * of them reduce over `facilities`, which is one PAGE (pageSize 20).
   *
   * Same defect as the vendor row: the 2026-07-27 pass fixed only "Total
   * Facilities", leaving Active / Total Users / Total Contracts summed over the
   * page — one true number lending authority to three false ones. Facilities
   * happen to fit in a page today, which is exactly why nobody caught it here
   * first; do not rely on that staying true (Charles 2026-07-28).
   *
   * Renders "—" until the query resolves: a placeholder 0 is also a wrong
   * number under a confident label.
   */
  const stat = (value: number | undefined) => value ?? "—"

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
                <p className="text-2xl font-bold">{stat(data?.total)}</p>
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
                <p className="text-2xl font-bold">{stat(data?.activeTotal)}</p>
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
                <p className="text-2xl font-bold">{stat(data?.userTotal)}</p>
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
                <p className="text-2xl font-bold">{stat(data?.contractTotal)}</p>
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
        enableColumnFilters
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" /> Add Facility
          </Button>
        }
      />
      {/*
        The rows are one server page while the cards above are tenant-wide, so
        SAY which is which. A silent cap is the bug; a labelled one is a fact
        the operator can act on.
      */}
      {data && data.total > facilities.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {facilities.length} facilities alphabetically of{" "}
          {data.total}. Search, sorting and column filters apply to these{" "}
          {facilities.length} rows only — the totals above cover all {data.total}.
        </p>
      )}
      <FacilityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={async (d) => { try { await createMut.mutateAsync(d) } catch { /* surfaced via onError toast */ } }}
        isSubmitting={createMut.isPending}
      />
      {editing && (
        <FacilityFormDialog
          facility={{ id: editing.id, name: editing.name, type: editing.type as AdminCreateFacilityInput["type"], status: editing.status }}
          open={!!editing}
          onOpenChange={() => setEditing(null)}
          onSubmit={async (d) => { try { await updateMut.mutateAsync({ id: editing.id, input: d }) } catch { /* surfaced via onError toast */ } }}
          isSubmitting={updateMut.isPending}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Facility"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        onConfirm={async () => { if (deleting) { try { await deleteMut.mutateAsync(deleting.id) } catch { /* surfaced via onError toast */ } } }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

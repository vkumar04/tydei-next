"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Users, CheckCircle, Building2, Truck, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Stepper } from "@/components/shared/forms/stepper"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getUserColumns } from "./user-columns"
import {
  adminGetUsers,
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  type AdminUserRow,
} from "@/lib/actions/admin/users"
import { adminGetFacilities } from "@/lib/actions/admin/facilities"
import { adminGetVendors } from "@/lib/actions/admin/vendors"
import type { UserRole } from "@/lib/generated/prisma/client"
import { queryKeys } from "@/lib/query-keys"

export function UserTable() {
  const qc = useQueryClient()
  const [roleFilter, setRoleFilter] = useState<string>("all")

  // ─── Edit / Delete state ────────────────────────────────────────
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null)
  const [editFormData, setEditFormData] = useState<Record<string, string>>({})

  // ─── Add dialog state ───────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)
  const [addStep, setAddStep] = useState(1)
  const [addFormData, setAddFormData] = useState<Record<string, string>>({})
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([])
  const [selectedVendors, setSelectedVendors] = useState<string[]>([])

  const filters =
    roleFilter === "all"
      ? {}
      : roleFilter === "operator"
        ? { role: "admin" as UserRole }
        : { role: roleFilter as UserRole }

  // ─── Queries ────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.users(filters),
    queryFn: () => adminGetUsers(filters),
  })

  const { data: facilityData } = useQuery({
    queryKey: queryKeys.admin.facilities({}),
    queryFn: () => adminGetFacilities({}),
  })

  const { data: vendorData } = useQuery({
    queryKey: queryKeys.admin.vendors({}),
    queryFn: () => adminGetVendors({}),
  })

  // ─── Mutations ──────────────────────────────────────────────────
  // Charles 2026-06-20: surface admin mutation failures as toasts instead of
  // unhandled rejections (the "add a user … times out / switches pages"
  // symptom — a thrown server action escalated to Next's error boundary).
  const onMutationError = (verb: string) => (err: unknown) =>
    toast.error(err instanceof Error ? err.message : `Failed to ${verb} user`)

  const createMut = useMutation({
    mutationFn: adminCreateUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.usersBase }); resetAddForm(); toast.success("User created — invite sent") },
    onError: onMutationError("create"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, string> }) => adminUpdateUser(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.usersBase }); setEditing(null); toast.success("User updated") },
    onError: onMutationError("update"),
  })

  const deleteMut = useMutation({
    mutationFn: adminDeleteUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.usersBase }); setDeleting(null); toast.success("User deleted") },
    onError: onMutationError("delete"),
  })


  // ─── Add-user stepper ───────────────────────────────────────────
  const addRole = (addFormData.role ?? "facility") as UserRole
  const isVendorRole = addRole === "vendor"
  /** Platform admins aren't tenant-scoped, so there is nothing to assign. */
  const needsAccessStep = addRole !== "admin"
  const facilityOptions = facilityData?.facilities ?? []
  const vendorOptions = vendorData?.vendors ?? []
  const selectedAccessIds = isVendorRole ? selectedVendors : selectedFacilities

  const step1Complete =
    (addFormData.name ?? "").trim().length >= 2 &&
    /.+@.+\..+/.test(addFormData.email ?? "")
  // A scoped user with no organization can't load a portal at all, so the
  // access step is required for them — but not for admins.
  const canSubmit = step1Complete && (!needsAccessStep || selectedAccessIds.length > 0)

  const STEP_LABELS = ["Details", needsAccessStep ? "Access" : "Review"]

  // ─── Columns ────────────────────────────────────────────────────
  const columns = getUserColumns(
    (u) => { setEditing(u); setEditFormData({ name: u.name, email: u.email, role: u.role }) },
    (u) => setDeleting(u)
  )

  // ─── Handlers ───────────────────────────────────────────────────
  const handleEditSubmit = async () => {
    if (editing) {
      try {
        await updateMut.mutateAsync({ id: editing.id, input: editFormData })
      } catch { /* surfaced via onError toast */ }
    }
  }

  const handleAddSubmit = async () => {
    try {
      await createMut.mutateAsync({
        name: addFormData.name ?? "",
        email: addFormData.email ?? "",
        role: addRole,
        // Previously collected and thrown away — these now actually grant
        // access (Member + FacilityAssignment rows).
        facilityIds: isVendorRole || addRole === "admin" ? [] : selectedFacilities,
        vendorIds: isVendorRole ? selectedVendors : [],
      })
    } catch { /* surfaced via onError toast */ }
  }

  const resetAddForm = () => {
    setAddOpen(false)
    setAddStep(1)
    setAddFormData({})
    setSelectedFacilities([])
    setSelectedVendors([])
  }

  const toggleFacility = (id: string) => {
    setSelectedFacilities((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    )
  }

  const toggleVendor = (id: string) => {
    setSelectedVendors((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    )
  }



  // ─── Derived ────────────────────────────────────────────────────
  const users = data?.users ?? []
  const activeUsers = users.filter((u) => u.role !== "admin")
  const facilityUsers = users.filter((u) => u.role === "facility")
  const vendorUsers = users.filter((u) => u.role === "vendor")

  return (
    <>
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-xs text-muted-foreground">Total Users</p>
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
                <p className="text-2xl font-bold">{activeUsers.length}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Building2 className="h-5 w-5 text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{facilityUsers.length}</p>
                <p className="text-xs text-muted-foreground">Facility Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                <Truck className="h-5 w-5 text-purple-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{vendorUsers.length}</p>
                <p className="text-xs text-muted-foreground">Vendor Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + Table */}
      <Tabs value={roleFilter} onValueChange={setRoleFilter} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="facility">Facility</TabsTrigger>
          <TabsTrigger value="vendor">Vendor</TabsTrigger>
          <TabsTrigger value="operator">Operator</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={users}
        searchKey="name"
        searchPlaceholder="Search users..."
        isLoading={isLoading}
        enableColumnFilters
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => { resetAddForm(); setAddOpen(true) }}>
            <Plus className="size-4" /> Add User
          </Button>
        }
      />

      {/* ─── Add User (2-step stepper) ───────────────────────────── */}
      {/*
        Was a 3-tab form with a password field. Two problems it had:
          - the admin chose someone else's password, which then had to be
            communicated out of band and stayed known to the admin;
          - Access Management and Notifications collected input that
            handleAddSubmit never sent, so ticking facilities did nothing.
        Now: two steps that BOTH persist, and the person sets their own
        password from the invite link. Notification prefs are organization-
        scoped (Organization.metadata), so they stay in Settings rather than
        pretending to be a per-user choice here.
      */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) resetAddForm() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              {addStep === 1
                ? "Who are they, and what kind of account is this?"
                : needsAccessStep
                  ? "Choose which organizations they can access."
                  : "Review and send the invite."}
            </DialogDescription>
          </DialogHeader>

          <Stepper current={addStep} steps={STEP_LABELS} />

          <div className="flex-1 overflow-auto px-1">
            {addStep === 1 && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Full Name <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="Enter full name"
                      value={addFormData.name ?? ""}
                      onChange={(e) => setAddFormData({ ...addFormData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email <span className="text-destructive">*</span></Label>
                    <Input
                      type="email"
                      placeholder="user@example.com"
                      value={addFormData.email ?? ""}
                      onChange={(e) => setAddFormData({ ...addFormData, email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Role <span className="text-destructive">*</span></Label>
                  <Select
                    value={addFormData.role ?? "facility"}
                    onValueChange={(v) => {
                      // Switching role invalidates the other side's picks.
                      setAddFormData({ ...addFormData, role: v })
                      setSelectedFacilities([])
                      setSelectedVendors([])
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facility">Facility</SelectItem>
                      <SelectItem value="vendor">Vendor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                  No password here — we email an invite and they choose their
                  own. The link is valid for 7 days.
                </p>
              </div>
            )}

            {addStep === 2 && needsAccessStep && (
              <div className="space-y-3">
                <Label>
                  {isVendorRole ? "Vendors" : "Facilities"}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <ScrollArea className="h-64 rounded-md border p-3">
                  <div className="space-y-2">
                    {(isVendorRole ? vendorOptions : facilityOptions).map((o) => (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-muted"
                      >
                        <Checkbox
                          checked={(isVendorRole ? selectedVendors : selectedFacilities).includes(o.id)}
                          onCheckedChange={() =>
                            isVendorRole ? toggleVendor(o.id) : toggleFacility(o.id)
                          }
                        />
                        <span className="text-sm">{o.name}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
                <p className="text-xs text-muted-foreground">
                  {selectedAccessIds.length} selected. The first grants
                  organization membership; any others add scoped access.
                </p>
              </div>
            )}

            {addStep === 2 && !needsAccessStep && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Platform admins aren&apos;t scoped to a facility or vendor —
                  they see every tenant, so there is nothing to assign.
                </p>
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p><span className="text-muted-foreground">Name:</span> {addFormData.name}</p>
                  <p><span className="text-muted-foreground">Email:</span> {addFormData.email}</p>
                  <p><span className="text-muted-foreground">Role:</span> Admin</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {addStep === 1 ? (
              <Button variant="outline" onClick={resetAddForm}>Cancel</Button>
            ) : (
              <Button variant="outline" onClick={() => setAddStep(1)}>Back</Button>
            )}
            {addStep === 1 ? (
              <Button onClick={() => setAddStep(2)} disabled={!step1Complete}>
                Next
              </Button>
            ) : (
              <Button onClick={handleAddSubmit} disabled={createMut.isPending || !canSubmit}>
                {createMut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create user & send invite
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit User Dialog (simple) ───────────────────────────── */}
      <FormDialog
        open={!!editing}
        onOpenChange={(open) => { if (!open) setEditing(null) }}
        title="Edit User"
        description="Modify user details"
        onSubmit={handleEditSubmit}
        isSubmitting={updateMut.isPending}
      >
        <Field label="Name" required>
          <Input value={editFormData.name ?? ""} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} />
        </Field>
        <Field label="Email" required>
          <Input value={editFormData.email ?? ""} onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })} />
        </Field>
        <Field label="Role" required>
          <Select value={editFormData.role ?? "facility"} onValueChange={(v) => setEditFormData({ ...editFormData, role: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="facility">Facility</SelectItem>
              <SelectItem value="vendor">Vendor</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FormDialog>

      {/* ─── Delete Confirm ──────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete User"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        onConfirm={async () => { if (deleting) { try { await deleteMut.mutateAsync(deleting.id) } catch { /* surfaced via onError toast */ } } }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Users, CheckCircle, Building2, Truck, Mail, XCircle, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import type { UserRole } from "@prisma/client"
import { queryKeys } from "@/lib/query-keys"

// ─── Notification preference keys ───────────────────────────────
const NOTIFICATION_PREFS = [
  { key: "contractAlerts", label: "Contract Alerts" },
  { key: "rebateNotifications", label: "Rebate Notifications" },
  { key: "complianceAlerts", label: "Compliance Alerts" },
  { key: "systemUpdates", label: "System Updates" },
] as const

type NotificationPrefs = Record<string, boolean>

const defaultNotificationPrefs: NotificationPrefs = {
  contractAlerts: true,
  rebateNotifications: true,
  complianceAlerts: true,
  systemUpdates: false,
}

export function UserTable() {
  const qc = useQueryClient()
  const [roleFilter, setRoleFilter] = useState<string>("all")

  // ─── Edit / Delete state ────────────────────────────────────────
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null)
  const [editFormData, setEditFormData] = useState<Record<string, string>>({})

  // ─── Add dialog state ───────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)
  const [addTab, setAddTab] = useState("basic")
  const [addFormData, setAddFormData] = useState<Record<string, string>>({})
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([])
  const [selectedVendors, setSelectedVendors] = useState<string[]>([])
  const [notificationEmails, setNotificationEmails] = useState<string[]>([])
  const [newNotificationEmail, setNewNotificationEmail] = useState("")
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(defaultNotificationPrefs)

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
  const createMut = useMutation({
    mutationFn: adminCreateUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); resetAddForm(); toast.success("User created") },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, string> }) => adminUpdateUser(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); setEditing(null); toast.success("User updated") },
  })

  const deleteMut = useMutation({
    mutationFn: adminDeleteUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); setDeleting(null); toast.success("User deleted") },
  })

  // ─── Columns ────────────────────────────────────────────────────
  const columns = getUserColumns(
    (u) => { setEditing(u); setEditFormData({ name: u.name, email: u.email, role: u.role }) },
    (u) => setDeleting(u)
  )

  // ─── Handlers ───────────────────────────────────────────────────
  const handleEditSubmit = async () => {
    if (editing) {
      await updateMut.mutateAsync({ id: editing.id, input: editFormData })
    }
  }

  const handleAddSubmit = async () => {
    await createMut.mutateAsync({
      name: addFormData.name ?? "",
      email: addFormData.email ?? "",
      password: addFormData.password ?? "",
      role: (addFormData.role ?? "facility") as UserRole,
    })
  }

  const resetAddForm = () => {
    setAddOpen(false)
    setAddTab("basic")
    setAddFormData({})
    setSelectedFacilities([])
    setSelectedVendors([])
    setNotificationEmails([])
    setNewNotificationEmail("")
    setNotificationPrefs(defaultNotificationPrefs)
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

  const addNotificationEmail = () => {
    const email = newNotificationEmail.trim().toLowerCase()
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address")
      return
    }
    if (notificationEmails.includes(email)) {
      toast.error("This email is already added")
      return
    }
    setNotificationEmails((prev) => [...prev, email])
    setNewNotificationEmail("")
  }

  const removeNotificationEmail = (email: string) => {
    setNotificationEmails((prev) => prev.filter((e) => e !== email))
  }

  // ─── Derived ────────────────────────────────────────────────────
  const users = data?.users ?? []
  const activeUsers = users.filter((u) => u.role !== "admin")
  const facilityUsers = users.filter((u) => u.role === "facility")
  const vendorUsers = users.filter((u) => u.role === "vendor")
  const facilities = facilityData?.facilities ?? []
  const vendors = vendorData?.vendors ?? []

  const userType = addFormData.role === "vendor" ? "vendor" : "facility"

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
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => { resetAddForm(); setAddOpen(true) }}>
            <Plus className="size-4" /> Add User
          </Button>
        }
      />

      {/* ─── Add User Dialog (multi-tab) ─────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) resetAddForm() }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a new user account and assign organization access
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            <Tabs value={addTab} onValueChange={setAddTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="access">Access Management</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Basic Info ────────────────────────────── */}
              <TabsContent value="basic" className="mt-4 space-y-4">
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Password <span className="text-destructive">*</span></Label>
                    <Input
                      type="password"
                      placeholder="Min. 8 characters"
                      value={addFormData.password ?? ""}
                      onChange={(e) => setAddFormData({ ...addFormData, password: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Role <span className="text-destructive">*</span></Label>
                    <Select
                      value={addFormData.role ?? "facility"}
                      onValueChange={(v) => setAddFormData({ ...addFormData, role: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="facility">Facility</SelectItem>
                        <SelectItem value="vendor">Vendor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab 2: Access Management ─────────────────────── */}
              <TabsContent value="access" className="mt-4 space-y-4">
                {userType === "facility" ? (
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Facility Access
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Select facilities this user can access
                    </p>
                    <ScrollArea className="h-[280px] rounded-md border p-3">
                      <div className="space-y-2">
                        {facilities.length === 0 && (
                          <p className="text-sm text-muted-foreground py-4 text-center">No facilities found</p>
                        )}
                        {facilities.map((f) => (
                          <div key={f.id} className="flex items-center gap-3">
                            <Checkbox
                              id={`fac-${f.id}`}
                              checked={selectedFacilities.includes(f.id)}
                              onCheckedChange={() => toggleFacility(f.id)}
                            />
                            <label htmlFor={`fac-${f.id}`} className="flex-1 cursor-pointer">
                              <div className="font-medium text-sm">{f.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {[f.city, f.state].filter(Boolean).join(", ") || f.type}
                                {f.healthSystemName && ` - ${f.healthSystemName}`}
                              </div>
                            </label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    {selectedFacilities.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selectedFacilities.length} facilit{selectedFacilities.length === 1 ? "y" : "ies"} selected
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Vendor Access
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Select vendor companies this user can access
                    </p>
                    <ScrollArea className="h-[280px] rounded-md border p-3">
                      <div className="space-y-2">
                        {vendors.length === 0 && (
                          <p className="text-sm text-muted-foreground py-4 text-center">No vendors found</p>
                        )}
                        {vendors.map((v) => (
                          <div key={v.id} className="flex items-center gap-3">
                            <Checkbox
                              id={`ven-${v.id}`}
                              checked={selectedVendors.includes(v.id)}
                              onCheckedChange={() => toggleVendor(v.id)}
                            />
                            <label htmlFor={`ven-${v.id}`} className="flex-1 cursor-pointer">
                              <div className="font-medium text-sm">{v.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {v.code ? `${v.code} - ` : ""}{v.tier} tier - {v.contractCount} contracts
                              </div>
                            </label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    {selectedVendors.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selectedVendors.length} vendor{selectedVendors.length === 1 ? "" : "s"} selected
                      </p>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Tab 3: Notification Settings ─────────────────── */}
              <TabsContent value="notifications" className="mt-4 space-y-4">
                <div>
                  <Label className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Notification Settings
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Configure email addresses and notification preferences for this user
                  </p>
                </div>

                {/* Notification Emails */}
                <div className="space-y-3">
                  <Label className="text-sm">Notification Emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Add additional email addresses to receive notifications (e.g., team inboxes, assistants)
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="Enter email address"
                      value={newNotificationEmail}
                      onChange={(e) => setNewNotificationEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNotificationEmail() } }}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" onClick={addNotificationEmail}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {notificationEmails.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {notificationEmails.map((email) => (
                        <Badge key={email} variant="secondary" className="gap-1 pl-2">
                          <Mail className="h-3 w-3" />
                          {email}
                          <button
                            type="button"
                            onClick={() => removeNotificationEmail(email)}
                            className="ml-1 hover:bg-destructive/20 rounded p-0.5"
                          >
                            <XCircle className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notification Preferences */}
                <div className="space-y-3">
                  <Label className="text-sm">Notification Types</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {NOTIFICATION_PREFS.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox
                          id={`notif-${key}`}
                          checked={notificationPrefs[key] ?? false}
                          onCheckedChange={(checked) =>
                            setNotificationPrefs((prev) => ({ ...prev, [key]: !!checked }))
                          }
                        />
                        <label htmlFor={`notif-${key}`} className="text-sm cursor-pointer">
                          {label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={resetAddForm}>
              Cancel
            </Button>
            <Button onClick={handleAddSubmit} disabled={createMut.isPending}>
              {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create User
            </Button>
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
        onConfirm={async () => { if (deleting) await deleteMut.mutateAsync(deleting.id) }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

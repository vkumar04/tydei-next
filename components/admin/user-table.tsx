"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Users, CheckCircle, Building2, Truck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
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
import type { UserRole } from "@prisma/client"
import { queryKeys } from "@/lib/query-keys"

export function UserTable() {
  const qc = useQueryClient()
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})

  const filters = roleFilter === "all" ? {} : { role: roleFilter as UserRole }

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.users(filters),
    queryFn: () => adminGetUsers(filters),
  })

  const createMut = useMutation({
    mutationFn: adminCreateUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); setFormOpen(false); toast.success("User created") },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, string> }) => adminUpdateUser(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); setEditing(null); toast.success("User updated") },
  })

  const deleteMut = useMutation({
    mutationFn: adminDeleteUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "users"] }); setDeleting(null); toast.success("User deleted") },
  })

  const columns = getUserColumns(
    (u) => { setEditing(u); setFormData({ name: u.name, email: u.email, role: u.role }) },
    (u) => setDeleting(u)
  )

  const handleSubmit = async () => {
    if (editing) {
      await updateMut.mutateAsync({ id: editing.id, input: formData })
    } else {
      await createMut.mutateAsync({
        name: formData.name ?? "",
        email: formData.email ?? "",
        password: formData.password ?? "",
        role: (formData.role ?? "facility") as UserRole,
      })
    }
  }

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
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-700" />
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
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <Building2 className="h-5 w-5 text-blue-700" />
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
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={users}
        searchKey="name"
        searchPlaceholder="Search users..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => { setFormData({}); setFormOpen(true) }}>
            <Plus className="size-4" /> Add User
          </Button>
        }
      />
      <FormDialog
        open={formOpen || !!editing}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setEditing(null) } }}
        title={editing ? "Edit User" : "Create User"}
        description={editing ? "Modify user details" : "Create a new user account and assign a role"}
        onSubmit={handleSubmit}
        isSubmitting={createMut.isPending || updateMut.isPending}
      >
        <Field label="Name" required>
          <Input value={formData.name ?? ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
        </Field>
        <Field label="Email" required>
          <Input value={formData.email ?? ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
        </Field>
        {!editing && (
          <Field label="Password" required>
            <Input type="password" value={formData.password ?? ""} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
          </Field>
        )}
        <Field label="Role" required>
          <Select value={formData.role ?? "facility"} onValueChange={(v) => setFormData({ ...formData, role: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="facility">Facility</SelectItem>
              <SelectItem value="vendor">Vendor</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FormDialog>
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

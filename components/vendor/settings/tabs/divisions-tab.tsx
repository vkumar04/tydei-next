"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Plus, Trash2, Pencil, X, Users } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useVendorDivisionsWithMembers,
  useAttachableVendorUsers,
  useCreateVendorDivision,
  useUpdateVendorDivision,
  useDeleteVendorDivision,
  useAttachUserToDivision,
  useDetachUserFromDivision,
} from "@/hooks/use-divisions"
import type {
  DivisionWithMembers,
  DivisionMemberUser,
} from "@/lib/actions/division-members"

export interface DivisionsTabProps {
  /** The caller's vendor id — scopes the query keys. */
  vendorId: string
  /** Super-only management. When false, the tab is read-only. */
  canManage: boolean
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error"
}

export function DivisionsTab({ vendorId, canManage }: DivisionsTabProps) {
  const { data: divisions, isLoading } = useVendorDivisionsWithMembers(vendorId)
  const { data: attachable } = useAttachableVendorUsers(vendorId)

  const createMut = useCreateVendorDivision()
  const updateMut = useUpdateVendorDivision()
  const deleteMut = useDeleteVendorDivision()
  const attachMut = useAttachUserToDivision()
  const detachMut = useDetachUserFromDivision()

  // New-division draft (create form).
  const [newName, setNewName] = useState("")
  const [newCode, setNewCode] = useState("")
  const [newCategories, setNewCategories] = useState("")

  // Per-division edit state (id being edited).
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editCode, setEditCode] = useState("")
  const [editCategories, setEditCategories] = useState("")

  function parseCategories(raw: string): string[] {
    return raw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
  }

  function handleCreate() {
    createMut.mutate(
      {
        name: newName.trim(),
        code: newCode.trim(),
        categories: parseCategories(newCategories),
      },
      {
        onSuccess: () => {
          setNewName("")
          setNewCode("")
          setNewCategories("")
          toast.success("Division created")
        },
        onError: (err) => toast.error(`Failed to create division: ${errMessage(err)}`),
      },
    )
  }

  function startEdit(d: DivisionWithMembers) {
    setEditId(d.id)
    setEditName(d.name)
    setEditCode(d.code)
    setEditCategories(d.categories.join(", "))
  }

  function handleUpdate() {
    if (!editId) return
    updateMut.mutate(
      {
        id: editId,
        name: editName.trim(),
        code: editCode.trim(),
        categories: parseCategories(editCategories),
      },
      {
        onSuccess: () => {
          setEditId(null)
          toast.success("Division updated")
        },
        onError: (err) => toast.error(`Failed to update division: ${errMessage(err)}`),
      },
    )
  }

  function handleDelete(id: string) {
    deleteMut.mutate(id, {
      onSuccess: () => toast.success("Division deleted"),
      onError: (err) => toast.error(`Failed to delete division: ${errMessage(err)}`),
    })
  }

  function handleAttach(divisionId: string, userId: string) {
    attachMut.mutate(
      { divisionId, userId },
      {
        onSuccess: () => toast.success("User attached"),
        onError: (err) => toast.error(`Failed to attach user: ${errMessage(err)}`),
      },
    )
  }

  function handleDetach(divisionId: string, userId: string) {
    detachMut.mutate(
      { divisionId, userId },
      {
        onSuccess: () => toast.success("User detached"),
        onError: (err) => toast.error(`Failed to detach user: ${errMessage(err)}`),
      },
    )
  }

  if (isLoading) {
    return <Skeleton className="h-96 rounded-xl" />
  }

  const divisionList = divisions ?? []
  const attachableUsers: DivisionMemberUser[] = attachable ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Divisions &amp; Members</CardTitle>
        <CardDescription>
          Define divisions (business units) within your organization and attach
          users. A user&apos;s visibility is scoped to the divisions they belong to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Create form (Super only) */}
        {canManage && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Orthopedics"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Code</Label>
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="e.g. ORTHO"
                  maxLength={50}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Categories (comma-separated)
                </Label>
                <Input
                  value={newCategories}
                  onChange={(e) => setNewCategories(e.target.value)}
                  placeholder="e.g. Implants, Instruments"
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={!newName.trim() || !newCode.trim() || createMut.isPending}
              onClick={handleCreate}
            >
              <Plus className="h-4 w-4" />
              {createMut.isPending ? "Adding…" : "Add division"}
            </Button>
          </div>
        )}

        {/* Division list */}
        {divisionList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No divisions yet.</p>
        ) : (
          <div className="space-y-4">
            {divisionList.map((d) => {
              const isEditing = editId === d.id
              const attachedIds = new Set(d.members.map((m) => m.id))
              const unattached = attachableUsers.filter((u) => !attachedIds.has(u.id))
              return (
                <div key={d.id} className="rounded-lg border p-4 space-y-3">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={100}
                        />
                        <Input
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          maxLength={50}
                        />
                        <Input
                          value={editCategories}
                          onChange={(e) => setEditCategories(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={updateMut.isPending}
                          onClick={handleUpdate}
                        >
                          {updateMut.isPending ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{d.name}</span>
                          <Badge variant="secondary">{d.code}</Badge>
                          {d.isDefault && <Badge variant="outline">Default</Badge>}
                        </div>
                        {d.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {d.categories.map((c) => (
                              <Badge key={c} variant="outline" className="text-xs">
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => startEdit(d)}
                            aria-label="Edit division"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={d.isDefault || deleteMut.isPending}
                            onClick={() => handleDelete(d.id)}
                            aria-label="Delete division"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Attached members */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>Members ({d.members.length})</span>
                    </div>
                    {d.members.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No users attached.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {d.members.map((m) => (
                          <Badge key={m.id} variant="secondary" className="gap-1 pr-1">
                            <span>{m.name || m.email}</span>
                            {canManage && (
                              <button
                                type="button"
                                className="ml-1 rounded-sm hover:bg-muted"
                                aria-label={`Detach ${m.name || m.email}`}
                                onClick={() => handleDetach(d.id, m.id)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Attach selector */}
                    {canManage && unattached.length > 0 && (
                      <Select
                        value=""
                        onValueChange={(userId) => handleAttach(d.id, userId)}
                      >
                        <SelectTrigger className="h-8 w-64 text-xs">
                          <SelectValue placeholder="Attach a user…" />
                        </SelectTrigger>
                        <SelectContent>
                          {unattached.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name || u.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

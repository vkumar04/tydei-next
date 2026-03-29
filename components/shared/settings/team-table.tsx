"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import type { TeamMember } from "@/lib/actions/settings"

interface TeamTableProps {
  members: TeamMember[]
  onRemove: (id: string) => void
  onRoleChange: (id: string, role: string) => void
  isAdmin: boolean
  roles?: { value: string; label: string }[]
}

const DEFAULT_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
]

export function TeamTable({
  members,
  onRemove,
  onRoleChange,
  isAdmin,
  roles = DEFAULT_ROLES,
}: TeamTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
          {isAdmin && <TableHead className="w-[60px]" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="size-8">
                  <AvatarImage src={m.image ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {m.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
              </div>
            </TableCell>
            <TableCell>
              {isAdmin ? (
                <Select
                  value={m.role}
                  onValueChange={(v) => onRoleChange(m.id, v)}
                >
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{m.role}</Badge>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(m.createdAt).toLocaleDateString()}
            </TableCell>
            {isAdmin && (
              <TableCell>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-destructive"
                  onClick={() => onRemove(m.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

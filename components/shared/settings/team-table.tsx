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
import { ACCESS_TIERS, ACCESS_TIER_LABELS } from "@/lib/auth/permissions"
import { formatDate } from "@/lib/formatting"

interface TeamTableProps {
  members: TeamMember[]
  onRemove: (id: string) => void
  onRoleChange: (id: string, role: string) => void
  isAdmin: boolean
  roles?: { value: string; label: string }[]
  /**
   * Settings/Users feature: when provided (Super-tier caller only), an
   * "Access" column renders a tier select per member. Omitted ⇒ no column
   * (back-compat for callers that don't manage tiers).
   */
  onAccessTierChange?: (id: string, tier: string) => void
}

// Server enforces admin|member (settings.ts updateRoleSchema) —
// "viewer" was a phantom option that always failed Zod (2026-06-09).
const DEFAULT_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
]

export function TeamTable({
  members,
  onRemove,
  onRoleChange,
  isAdmin,
  roles = DEFAULT_ROLES,
  onAccessTierChange,
}: TeamTableProps) {
  const showAccess = Boolean(onAccessTierChange)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          {showAccess && <TableHead>Access</TableHead>}
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
              {/* Owner is creator-only: not in the assignable enum and
                  protected server-side (only an owner can modify the
                  owner) — render as a static badge, not a Select. */}
              {isAdmin && m.role !== "owner" ? (
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
            {showAccess && (
              <TableCell>
                {/* Owner keeps full access implicitly; don't offer to
                    down-tier the owner here. */}
                {m.role !== "owner" ? (
                  <Select
                    value={m.accessTier}
                    onValueChange={(v) => onAccessTierChange?.(m.id, v)}
                  >
                    <SelectTrigger className="h-8 w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCESS_TIERS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {ACCESS_TIER_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline">{ACCESS_TIER_LABELS.super}</Badge>
                )}
              </TableCell>
            )}
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(m.createdAt)}
            </TableCell>
            {isAdmin && (
              <TableCell>
                {m.role !== "owner" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive"
                    onClick={() => onRemove(m.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

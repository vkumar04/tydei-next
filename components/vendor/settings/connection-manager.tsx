"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Building2, Check, Plus, Trash2, X } from "lucide-react"
import type { ConnectionData } from "@/lib/actions/connections"

interface ConnectionManagerProps {
  connections: ConnectionData[]
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRemove: (id: string) => void
  onInvite: (email: string, name: string, message?: string) => void
}

export function ConnectionManager({
  connections,
  onAccept,
  onReject,
  onRemove,
  onInvite,
}: ConnectionManagerProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")

  const active = connections.filter((c) => c.status === "accepted")
  const pending = connections.filter((c) => c.status === "pending")

  function handleInvite() {
    if (!email || !name) return
    onInvite(email, name, message || undefined)
    setInviteOpen(false)
    setEmail("")
    setName("")
    setMessage("")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Facility Connections</h3>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <Plus className="mr-1.5 size-4" />
          Invite Facility
        </Button>
      </div>

      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pending Invites ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{c.facilityName}</p>
                    <p className="text-xs text-muted-foreground">{c.invitedByEmail}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => onAccept(c.id)}>
                    <Check className="size-4 text-emerald-500" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => onReject(c.id)}>
                    <X className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Active Connections ({active.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {active.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No active connections</p>
          ) : (
            active.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{c.facilityName}</p>
                    <Badge variant="secondary" className="text-xs">Connected</Badge>
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => onRemove(c.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Invite Facility</DialogTitle>
            <DialogDescription>Send a connection invite to a facility.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Facility Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="General Hospital" />
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@hospital.com" />
            </div>
            <div className="space-y-2">
              <Label>Message (optional)</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!email || !name}>Send Invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

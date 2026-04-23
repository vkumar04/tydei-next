import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Send, Clock, X, Check, CheckCircle2, Link2 } from "lucide-react"
import type { ConnectionData } from "@/lib/actions/connections"

export interface ConnectionsTabProps {
  connectionData: ConnectionData[] | undefined
  connectionIsLoading: boolean
  inviteFacilityDialogOpen: boolean
  onSetInviteFacilityDialogOpen: (open: boolean) => void
  newInviteFacilityName: string
  onSetNewInviteFacilityName: (name: string) => void
  newInviteMessage: string
  onSetNewInviteMessage: (message: string) => void
  onSendInvite: () => void
  onAcceptConnection: (id: string) => void
  onRejectConnection: (id: string) => void
  onRemoveConnection: (id: string) => void
}

export function ConnectionsTab({
  connectionData,
  connectionIsLoading,
  inviteFacilityDialogOpen,
  onSetInviteFacilityDialogOpen,
  newInviteFacilityName,
  onSetNewInviteFacilityName,
  newInviteMessage,
  onSetNewInviteMessage,
  onSendInvite,
  onAcceptConnection,
  onRejectConnection,
  onRemoveConnection,
}: ConnectionsTabProps) {
  const accepted = connectionData?.filter((c) => c.status === "accepted") ?? []
  const pendingIncoming =
    connectionData?.filter(
      (c) => c.status === "pending" && c.inviteType === "facility_to_vendor"
    ) ?? []
  const pendingSent =
    connectionData?.filter(
      (c) => c.status === "pending" && c.inviteType === "vendor_to_facility"
    ) ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Facility Connections</CardTitle>
            <CardDescription>Manage connections with healthcare facilities</CardDescription>
          </div>
          <Dialog open={inviteFacilityDialogOpen} onOpenChange={onSetInviteFacilityDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Send className="mr-2 h-4 w-4" />
                Invite Facility
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Facility to Connect</DialogTitle>
                <DialogDescription>
                  Send a connection invite to a healthcare facility. They will be able to receive
                  your pricing and manage contracts.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="facility-name">Facility Name</Label>
                  <Input
                    id="facility-name"
                    placeholder="e.g., Memorial Hospital, St. Mary's Medical Center"
                    value={newInviteFacilityName}
                    onChange={(e) => onSetNewInviteFacilityName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-message">Message (Optional)</Label>
                  <Textarea
                    id="invite-message"
                    placeholder="Add a personal message to the invite..."
                    value={newInviteMessage}
                    onChange={(e) => onSetNewInviteMessage(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => onSetInviteFacilityDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={onSendInvite} disabled={!newInviteFacilityName.trim()}>
                  <Send className="mr-2 h-4 w-4" />
                  Send Invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {connectionIsLoading ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium">Active</span>
                </div>
                <p className="mt-2 text-2xl font-bold">{accepted.length}</p>
                <p className="text-sm text-muted-foreground">Connected facilities</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-500" />
                  <span className="font-medium">Pending</span>
                </div>
                <p className="mt-2 text-2xl font-bold">{pendingIncoming.length}</p>
                <p className="text-sm text-muted-foreground">Awaiting your response</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-500" />
                  <span className="font-medium">Sent</span>
                </div>
                <p className="mt-2 text-2xl font-bold">{pendingSent.length}</p>
                <p className="text-sm text-muted-foreground">Awaiting facility response</p>
              </div>
            </div>

            <Separator />

            {pendingIncoming.length > 0 && (
              <div className="space-y-4">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Pending Connection Requests
                </h3>
                <div className="space-y-3">
                  {pendingIncoming.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex items-center justify-between rounded-lg border bg-muted/40 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {connection.facilityName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{connection.facilityName}</p>
                          <p className="text-sm text-muted-foreground">
                            Invited by {connection.invitedByEmail} &bull;{" "}
                            {new Date(connection.invitedAt).toLocaleDateString()}
                          </p>
                          {connection.message && (
                            <p className="mt-1 text-sm italic">&quot;{connection.message}&quot;</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRejectConnection(connection.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button size="sm" onClick={() => onAcceptConnection(connection.id)}>
                          <Check className="mr-1 h-4 w-4" />
                          Accept
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="flex items-center gap-2 font-semibold">
                <Link2 className="h-4 w-4 text-green-500" />
                Active Connections
              </h3>
              {accepted.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Link2 className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>No active facility connections</p>
                  <p className="text-sm">Invite facilities to connect and share your pricing data</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Facility</TableHead>
                      <TableHead>Connected Since</TableHead>
                      <TableHead>Initiated By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accepted.map((connection) => (
                      <TableRow key={connection.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {connection.facilityName.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{connection.facilityName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {new Date(
                            connection.respondedAt || connection.invitedAt
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {connection.inviteType === "vendor_to_facility"
                              ? "You"
                              : connection.facilityName}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onRemoveConnection(connection.id)}
                          >
                            Disconnect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {pendingSent.length > 0 && (
              <div className="space-y-4">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Send className="h-4 w-4 text-blue-500" />
                  Sent Invites (Awaiting Response)
                </h3>
                <div className="space-y-2">
                  {pendingSent.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {connection.facilityName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{connection.facilityName}</p>
                          <p className="text-sm text-muted-foreground">
                            Sent {new Date(connection.invitedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveConnection(connection.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

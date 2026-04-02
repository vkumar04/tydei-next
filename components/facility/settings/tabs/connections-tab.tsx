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
} from "@/components/ui/dialog"
import {
  Send,
  Clock,
  X,
  Check,
  CheckCircle2,
  Link2,
} from "lucide-react"
import type { ConnectionData } from "@/lib/actions/connections"

export interface ConnectionsTabProps {
  connectionData: ConnectionData[] | undefined
  connectionIsLoading: boolean
  inviteVendorDialogOpen: boolean
  onSetInviteVendorDialogOpen: (open: boolean) => void
  newInviteVendorName: string
  onSetNewInviteVendorName: (name: string) => void
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
  inviteVendorDialogOpen,
  onSetInviteVendorDialogOpen,
  newInviteVendorName,
  onSetNewInviteVendorName,
  newInviteMessage,
  onSetNewInviteMessage,
  onSendInvite,
  onAcceptConnection,
  onRejectConnection,
  onRemoveConnection,
}: ConnectionsTabProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Vendor Connections</CardTitle>
            <CardDescription>Manage connections with vendor partners</CardDescription>
          </div>
          <Dialog open={inviteVendorDialogOpen} onOpenChange={onSetInviteVendorDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Vendor to Connect</DialogTitle>
                <DialogDescription>
                  Send a connection invite to a vendor. They will be able to share pricing and manage contracts with your facility.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="vendor-name">Vendor Name</Label>
                  <Input
                    id="vendor-name"
                    placeholder="e.g., Stryker, Arthrex, Medtronic"
                    value={newInviteVendorName}
                    onChange={(e) => onSetNewInviteVendorName(e.target.value)}
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
                <Button variant="outline" onClick={() => onSetInviteVendorDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={onSendInvite}
                  disabled={!newInviteVendorName.trim()}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send Invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={() => onSetInviteVendorDialogOpen(true)}>
            <Send className="mr-2 h-4 w-4" />
            Invite Vendor
          </Button>
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
                <p className="mt-2 text-2xl font-bold">
                  {connectionData?.filter(c => c.status === "accepted").length ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Connected vendors</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-500" />
                  <span className="font-medium">Pending</span>
                </div>
                <p className="mt-2 text-2xl font-bold">
                  {connectionData?.filter(c => c.status === "pending" && c.inviteType === "vendor_to_facility").length ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Awaiting your response</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-500" />
                  <span className="font-medium">Sent</span>
                </div>
                <p className="mt-2 text-2xl font-bold">
                  {connectionData?.filter(c => c.status === "pending" && c.inviteType === "facility_to_vendor").length ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Awaiting vendor response</p>
              </div>
            </div>

            <Separator />

            {(connectionData?.filter(c => c.status === "pending" && c.inviteType === "vendor_to_facility").length ?? 0) > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Pending Connection Requests
                </h3>
                <div className="space-y-3">
                  {connectionData
                    ?.filter(c => c.status === "pending" && c.inviteType === "vendor_to_facility")
                    .map(connection => (
                      <div key={connection.id} className="flex items-center justify-between rounded-lg border p-4 bg-amber-50 dark:bg-amber-900/10">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-amber-100 text-amber-700">
                              {connection.vendorName.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{connection.vendorName}</p>
                            <p className="text-sm text-muted-foreground">
                              Invited by {connection.invitedByEmail} &bull; {new Date(connection.invitedAt).toLocaleDateString()}
                            </p>
                            {connection.message && (
                              <p className="text-sm mt-1 italic">&quot;{connection.message}&quot;</p>
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
                          <Button
                            size="sm"
                            onClick={() => onAcceptConnection(connection.id)}
                          >
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
              <h3 className="font-semibold flex items-center gap-2">
                <Link2 className="h-4 w-4 text-green-500" />
                Active Connections
              </h3>
              {(connectionData?.filter(c => c.status === "accepted").length ?? 0) === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active vendor connections</p>
                  <p className="text-sm">Invite vendors to connect and share pricing data</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Connected Since</TableHead>
                      <TableHead>Initiated By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {connectionData
                      ?.filter(c => c.status === "accepted")
                      .map(connection => (
                        <TableRow key={connection.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                                  {connection.vendorName.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">{connection.vendorName}</span>
                            </div>
                          </TableCell>
                          <TableCell>{new Date(connection.respondedAt || connection.invitedAt).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {connection.inviteType === "facility_to_vendor" ? "You" : connection.vendorName}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 dark:text-red-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
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

            {(connectionData?.filter(c => c.status === "pending" && c.inviteType === "facility_to_vendor").length ?? 0) > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Send className="h-4 w-4 text-blue-500" />
                  Sent Invites (Awaiting Response)
                </h3>
                <div className="space-y-2">
                  {connectionData
                    ?.filter(c => c.status === "pending" && c.inviteType === "facility_to_vendor")
                    .map(connection => (
                      <div key={connection.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                              {connection.vendorName.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{connection.vendorName}</p>
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

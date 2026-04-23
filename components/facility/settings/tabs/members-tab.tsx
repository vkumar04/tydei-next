import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TeamTable } from "@/components/shared/settings/team-table"
import { InviteMemberDialog } from "@/components/shared/settings/invite-member-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  User,
  Shield,
  Eye,
  UserPlus,
} from "lucide-react"
import type { TeamMember } from "@/lib/actions/settings"

const TEAM_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
]

export interface MembersTabProps {
  teamData: TeamMember[] | undefined
  teamIsLoading: boolean
  inviteOpen: boolean
  onSetInviteOpen: (open: boolean) => void
  onRemoveMember: (id: string) => void
  onRoleChange: (id: string, role: string) => void
  onInviteMember: (email: string, role: string) => void
}

export function MembersTab({
  teamData,
  teamIsLoading,
  inviteOpen,
  onSetInviteOpen,
  onRemoveMember,
  onRoleChange,
  onInviteMember,
}: MembersTabProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage users and their access levels
              </CardDescription>
            </div>
            <Button onClick={() => onSetInviteOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple-500" />
              <span className="text-sm"><strong>Super Admin:</strong> Full system access</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              <span className="text-sm"><strong>Admin:</strong> Manage users &amp; settings</span>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-green-500" />
              <span className="text-sm"><strong>User:</strong> Standard access</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm"><strong>Viewer:</strong> Read-only</span>
            </div>
          </div>

          {teamIsLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : teamData ? (
            <TeamTable
              members={teamData}
              onRemove={onRemoveMember}
              onRoleChange={onRoleChange}
              isAdmin
              roles={TEAM_ROLES}
            />
          ) : null}
        </CardContent>
      </Card>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={onSetInviteOpen}
        onInvite={async (email, role) => {
          onInviteMember(email, role)
        }}
        roles={TEAM_ROLES}
      />
    </>
  )
}

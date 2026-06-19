"use client"

import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useFacilityAssignments,
  useAssignFacilityToUser,
  useUnassignFacilityFromUser,
} from "@/hooks/use-facility-assignment"

export interface FacilityAssignmentTabProps {
  /** The caller's facility-org id — scopes the query keys. */
  orgId: string
  /** Super-only management. When false, the matrix is read-only. */
  canManage: boolean
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error"
}

export function FacilityAssignmentTab({ orgId, canManage }: FacilityAssignmentTabProps) {
  const { data, isLoading } = useFacilityAssignments(orgId)
  const assignMut = useAssignFacilityToUser()
  const unassignMut = useUnassignFacilityFromUser()

  function toggle(userId: string, facilityId: string, currentlyAssigned: boolean) {
    if (currentlyAssigned) {
      unassignMut.mutate(
        { userId, facilityId },
        { onError: (err) => toast.error(`Failed to unassign: ${errMessage(err)}`) },
      )
    } else {
      assignMut.mutate(
        { userId, facilityId },
        { onError: (err) => toast.error(`Failed to assign: ${errMessage(err)}`) },
      )
    }
  }

  if (isLoading) {
    return <Skeleton className="h-96 rounded-xl" />
  }

  const facilities = data?.facilities ?? []
  const users = data?.users ?? []
  const pending = assignMut.isPending || unassignMut.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>Facility Assignments</CardTitle>
        <CardDescription>
          Assign users to specific facilities within your health system. Scoped
          users see only their assigned facilities; enterprise users see all.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {facilities.length === 0 || users.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {facilities.length === 0
              ? "No facilities in your health system."
              : "No users in your organization."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 text-left font-medium">User</th>
                  {facilities.map((f) => (
                    <th
                      key={f.id}
                      className="px-2 py-2 text-center font-medium whitespace-nowrap"
                    >
                      {f.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const assigned = new Set(u.assignedFacilityIds)
                  return (
                    <tr key={u.userId} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{u.name || u.email}</div>
                        {u.name && (
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        )}
                      </td>
                      {facilities.map((f) => {
                        const isAssigned = assigned.has(f.id)
                        return (
                          <td key={f.id} className="px-2 py-2 text-center">
                            <Checkbox
                              checked={isAssigned}
                              disabled={!canManage || pending}
                              onCheckedChange={() =>
                                toggle(u.userId, f.id, isAssigned)
                              }
                              aria-label={`Assign ${u.name || u.email} to ${f.name}`}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ProfileForm } from "@/components/facility/settings/profile-form"
import { Skeleton } from "@/components/ui/skeleton"
import { AccountProfileCard } from "@/components/shared/settings/account-profile-card"
import type { FacilityProfile } from "@/lib/actions/settings"
import type { UpdateFacilityProfileInput } from "@/lib/validators/settings"

export interface ProfileTabProps {
  profileData: FacilityProfile | undefined
  profileIsLoading: boolean
  // Retained (optional, unused) so the existing settings-client call site
  // keeps type-checking after the mocked password block was removed in
  // favor of <AccountProfileCard />.
  showPassword?: boolean
  onTogglePassword?: () => void
  onSaveProfile: (data: UpdateFacilityProfileInput) => void
  isSavingProfile: boolean
}

export function ProfileTab({
  profileData,
  profileIsLoading,
  onSaveProfile,
  isSavingProfile,
}: ProfileTabProps) {
  return (
    <div className="space-y-6">
      {/* Per-user identity (name / email / password) — self-scoped,
          replaces the previously-mocked account fields. */}
      <AccountProfileCard />

      {/* Organization profile (facility name / type / address / beds). */}
      <Card>
        <CardHeader>
          <CardTitle>Facility profile</CardTitle>
          <CardDescription>Manage your facility&apos;s organization details</CardDescription>
        </CardHeader>
        <CardContent>
          {profileIsLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : profileData ? (
            <ProfileForm
              facility={profileData}
              onSave={async (data) => {
                onSaveProfile(data)
              }}
              isPending={isSavingProfile}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

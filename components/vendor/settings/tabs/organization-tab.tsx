import { Skeleton } from "@/components/ui/skeleton"
import { VendorProfileForm } from "@/components/vendor/settings/vendor-profile-form"
import type { VendorProfile } from "@/lib/actions/settings"
import type { UpdateVendorProfileInput } from "@/lib/validators/settings"

export interface OrganizationTabProps {
  profileData: VendorProfile | undefined
  profileIsLoading: boolean
  onSaveProfile: (data: UpdateVendorProfileInput) => void
  isSavingProfile: boolean
}

export function OrganizationTab({
  profileData,
  profileIsLoading,
  onSaveProfile,
  isSavingProfile,
}: OrganizationTabProps) {
  if (profileIsLoading) {
    return <Skeleton className="h-[400px] rounded-xl" />
  }

  if (!profileData) return null

  return (
    <VendorProfileForm
      vendor={profileData}
      onSave={async (data) => {
        onSaveProfile(data)
      }}
      isPending={isSavingProfile}
    />
  )
}

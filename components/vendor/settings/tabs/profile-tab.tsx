import { AccountProfileCard } from "@/components/shared/settings/account-profile-card"
import type { VendorProfile } from "@/lib/actions/settings"

export interface ProfileTabProps {
  profileData: VendorProfile | undefined
  profileIsLoading: boolean
  // Retained (optional, unused) so the existing vendor-settings-client
  // call site keeps type-checking after the mocked password block was
  // removed in favor of <AccountProfileCard />.
  showPassword?: boolean
  onTogglePassword?: () => void
}

export function ProfileTab(_props: ProfileTabProps) {
  // Per-user identity (name / email / password) — self-scoped, replaces
  // the previously-mocked avatar / split-name / fake-email / mocked-
  // password blocks. The vendor *organization* profile is edited from
  // its own dedicated tab/section.
  return <AccountProfileCard />
}

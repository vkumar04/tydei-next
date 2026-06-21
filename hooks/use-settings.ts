"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getFacilityProfile,
  updateFacilityProfile,
  getVendorProfile,
  updateVendorProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
  getTeamMembers,
  inviteTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
  getFeatureFlags,
  updateFeatureFlags,
  getVendorTeamMembers,
  inviteVendorTeamMember,
  updateMemberAccessTier,
  type FeatureFlagData,
} from "@/lib/actions/settings"
import type {
  UpdateFacilityProfileInput,
  UpdateVendorProfileInput,
  NotificationPreferences,
} from "@/lib/validators/settings"

// ─── Facility Profile ────────────────────────────────────────────

export function useFacilityProfile(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.settings.facilityProfile(facilityId),
    queryFn: () => getFacilityProfile(facilityId),
  })
}

export function useUpdateFacilityProfile(facilityId: string) {
  return useToastMutation(
    (input: UpdateFacilityProfileInput) =>
      updateFacilityProfile(facilityId, input),
    { invalidate: [queryKeys.settings.facilityProfile(facilityId)] },
  )
}

// ─── Vendor Profile ──────────────────────────────────────────────

export function useVendorProfile(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.settings.vendorProfile(vendorId),
    queryFn: () => getVendorProfile(vendorId),
  })
}

export function useUpdateVendorProfile(vendorId: string) {
  return useToastMutation(
    (input: UpdateVendorProfileInput) => updateVendorProfile(vendorId, input),
    { invalidate: [queryKeys.settings.vendorProfile(vendorId)] },
  )
}

// ─── Notifications ───────────────────────────────────────────────

export function useNotificationPreferences(entityId: string) {
  return useQuery({
    queryKey: queryKeys.settings.notifications(entityId),
    queryFn: () => getNotificationPreferences(entityId),
  })
}

export function useUpdateNotificationPreferences(entityId: string) {
  return useToastMutation(
    (prefs: NotificationPreferences) =>
      updateNotificationPreferences(entityId, prefs),
    { invalidate: [queryKeys.settings.notifications(entityId)] },
  )
}

// ─── Team Members ────────────────────────────────────────────────

export function useTeamMembers(orgId: string) {
  return useQuery({
    queryKey: queryKeys.settings.team(orgId),
    queryFn: () => getTeamMembers(orgId),
    enabled: !!orgId,
  })
}

export function useInviteTeamMember(orgId: string) {
  return useToastMutation(
    (input: { email: string; role: string }) =>
      inviteTeamMember({ organizationId: orgId, ...input }),
    { invalidate: [queryKeys.settings.team(orgId)] },
  )
}

export function useRemoveTeamMember(orgId: string) {
  return useToastMutation((memberId: string) => removeTeamMember(memberId), {
    invalidate: [queryKeys.settings.team(orgId)],
  })
}

export function useUpdateTeamMemberRole(orgId: string) {
  return useToastMutation(
    ({ memberId, role }: { memberId: string; role: string }) =>
      updateTeamMemberRole(memberId, role),
    { invalidate: [queryKeys.settings.team(orgId)] },
  )
}

// Settings/Users feature: change a member's access tier (Super only).
export function useUpdateMemberAccessTier(orgId: string) {
  return useToastMutation(
    ({ memberId, tier }: { memberId: string; tier: string }) =>
      updateMemberAccessTier(memberId, tier),
    { invalidate: [queryKeys.settings.team(orgId)] },
  )
}

// ─── Feature Flags ───────────────────────────────────────────────

export function useFeatureFlags(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.settings.featureFlags(facilityId),
    queryFn: () => getFeatureFlags(facilityId),
  })
}

export function useUpdateFeatureFlags(facilityId: string) {
  return useToastMutation(
    (flags: Partial<FeatureFlagData>) => updateFeatureFlags(facilityId, flags),
    { invalidate: [queryKeys.settings.featureFlags(facilityId)] },
  )
}

// ─── Vendor Team ─────────────────────────────────────────────────

export function useVendorTeamMembers(orgId: string) {
  return useQuery({
    queryKey: queryKeys.settings.team(orgId),
    queryFn: () => getVendorTeamMembers(orgId),
    enabled: !!orgId,
  })
}

export function useInviteVendorTeamMember(orgId: string) {
  return useToastMutation(
    (input: { email: string; role: string; subRole: string }) =>
      inviteVendorTeamMember({ organizationId: orgId, ...input }),
    { invalidate: [queryKeys.settings.team(orgId)] },
  )
}

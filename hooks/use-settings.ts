"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateFacilityProfileInput) =>
      updateFacilityProfile(facilityId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.facilityProfile(facilityId) })
    },
  })
}

// ─── Vendor Profile ──────────────────────────────────────────────

export function useVendorProfile(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.settings.vendorProfile(vendorId),
    queryFn: () => getVendorProfile(vendorId),
  })
}

export function useUpdateVendorProfile(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateVendorProfileInput) =>
      updateVendorProfile(vendorId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.vendorProfile(vendorId) })
    },
  })
}

// ─── Notifications ───────────────────────────────────────────────

export function useNotificationPreferences(entityId: string) {
  return useQuery({
    queryKey: queryKeys.settings.notifications(entityId),
    queryFn: () => getNotificationPreferences(entityId),
  })
}

export function useUpdateNotificationPreferences(entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: NotificationPreferences) =>
      updateNotificationPreferences(entityId, prefs),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.notifications(entityId) })
    },
  })
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; role: string }) =>
      inviteTeamMember({ organizationId: orgId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.team(orgId) })
    },
  })
}

export function useRemoveTeamMember(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) => removeTeamMember(memberId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.team(orgId) })
    },
  })
}

export function useUpdateTeamMemberRole(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      updateTeamMemberRole(memberId, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.team(orgId) })
    },
  })
}

// ─── Feature Flags ───────────────────────────────────────────────

export function useFeatureFlags(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.settings.featureFlags(facilityId),
    queryFn: () => getFeatureFlags(facilityId),
  })
}

export function useUpdateFeatureFlags(facilityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (flags: Partial<FeatureFlagData>) =>
      updateFeatureFlags(facilityId, flags),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.featureFlags(facilityId) })
    },
  })
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; role: string; subRole: string }) =>
      inviteVendorTeamMember({ organizationId: orgId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.team(orgId) })
    },
  })
}

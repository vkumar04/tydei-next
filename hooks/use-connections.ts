"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getConnections,
  sendConnectionInvite,
  acceptConnection,
  rejectConnection,
  removeConnection,
} from "@/lib/actions/connections"
import {
  setConnectionMode,
  setConnectionAutoActivate,
  getVendorOperatingMode,
  setVendorOperatingMode,
} from "@/lib/actions/connection-mode"
import type { ConnectionStatus, ConnectionMode } from "@/lib/generated/prisma/client"

export function useConnections(
  entityId: string,
  type: "facility" | "vendor",
  status?: ConnectionStatus
) {
  return useQuery({
    queryKey: queryKeys.settings.connections(entityId),
    queryFn: () =>
      getConnections({
        ...(type === "facility" ? { facilityId: entityId } : { vendorId: entityId }),
        status,
      }),
  })
}

export function useSendConnectionInvite(entityId: string) {
  return useToastMutation(
    (input: { toEmail: string; toName: string; toId?: string; message?: string }) =>
      sendConnectionInvite(input),
    { invalidate: [queryKeys.settings.connections(entityId)] },
  )
}

export function useAcceptConnection(entityId: string) {
  return useToastMutation(
    (connectionId: string) => acceptConnection(connectionId),
    { invalidate: [queryKeys.settings.connections(entityId)] },
  )
}

export function useRejectConnection(entityId: string) {
  return useToastMutation(
    (connectionId: string) => rejectConnection(connectionId),
    { invalidate: [queryKeys.settings.connections(entityId)] },
  )
}

export function useRemoveConnection(entityId: string) {
  return useToastMutation(
    (connectionId: string) => removeConnection(connectionId),
    { invalidate: [queryKeys.settings.connections(entityId)] },
  )
}

// Vendor 1-/2-way mode toggle (vendor side only). Lets a vendor choose, per
// connection, whether their contracts flow to the facility (two_way) or stay
// private while they use their own COGs (one_way).
export function useSetConnectionMode(entityId: string) {
  return useToastMutation(
    ({ connectionId, mode }: { connectionId: string; mode: ConnectionMode }) =>
      setConnectionMode(connectionId, mode),
    { invalidate: [queryKeys.settings.connections(entityId)] },
  )
}

// Vendor-level operating mode (the standalone-vendor choice). Distinct from the
// per-connection toggle above.
export function useVendorOperatingMode(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.settings.vendorOperatingMode(vendorId),
    queryFn: () => getVendorOperatingMode(),
  })
}

export function useSetVendorOperatingMode(vendorId: string) {
  return useToastMutation(
    (mode: ConnectionMode) => setVendorOperatingMode(mode),
    { invalidate: [queryKeys.settings.vendorOperatingMode(vendorId)] },
  )
}

/**
 * Facility grants/revokes a vendor's right to publish contracts straight into
 * this facility's tenant with no per-contract review. The mirror of
 * `useSetConnectionMode` above, which is vendor-side — this one is facility-side
 * because the facility is the party carrying the risk.
 */
export function useSetConnectionAutoActivate(entityId: string) {
  return useToastMutation(
    ({ connectionId, enabled }: { connectionId: string; enabled: boolean }) =>
      setConnectionAutoActivate(connectionId, enabled),
    { invalidate: [queryKeys.settings.connections(entityId)] },
  )
}

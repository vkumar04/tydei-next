"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getConnections,
  sendConnectionInvite,
  acceptConnection,
  rejectConnection,
  removeConnection,
} from "@/lib/actions/connections"
import { setConnectionMode } from "@/lib/actions/connection-mode"
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      toEmail: string
      toName: string
      message?: string
    }) => sendConnectionInvite(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.connections(entityId) })
    },
  })
}

export function useAcceptConnection(entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) => acceptConnection(connectionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.connections(entityId) })
    },
  })
}

export function useRejectConnection(entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) => rejectConnection(connectionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.connections(entityId) })
    },
  })
}

export function useRemoveConnection(entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) => removeConnection(connectionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.connections(entityId) })
    },
  })
}

// Vendor 1-/2-way mode toggle (vendor side only). Lets a vendor choose, per
// connection, whether their contracts flow to the facility (two_way) or stay
// private while they use their own COGs (one_way).
export function useSetConnectionMode(entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, mode }: { connectionId: string; mode: ConnectionMode }) =>
      setConnectionMode(connectionId, mode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.connections(entityId) })
    },
  })
}

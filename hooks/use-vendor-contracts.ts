"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVendorContracts, getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import type { ContractStatus } from "@/lib/generated/prisma/client"

export function useVendorContracts(
  vendorId: string,
  filters?: { status?: ContractStatus | "all"; search?: string }
) {
  return useQuery({
    queryKey: queryKeys.vendorContracts.list(vendorId, filters),
    queryFn: () => getVendorContracts({ vendorId, ...filters }),
    // Bug #14 (2026-05-24): short staleTime so a vendor returning from
    // the facility-approval flow sees the newly-created Contract row
    // rather than a stale "0 contracts" result from before approval.
    staleTime: 30_000, // 30s
    refetchOnWindowFocus: true,
  })
}

export function useVendorContractDetail(id: string, vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorContracts.detail(id),
    queryFn: () => getVendorContractDetail(id, vendorId),
    enabled: !!id,
  })
}

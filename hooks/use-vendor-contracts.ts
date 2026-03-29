"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVendorContracts, getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import type { ContractStatus } from "@prisma/client"
import { toast } from "sonner"

export function useVendorContracts(
  vendorId: string,
  filters?: { status?: ContractStatus | "all"; search?: string }
) {
  return useQuery({
    queryKey: queryKeys.vendorContracts.list(vendorId, filters),
    queryFn: () => getVendorContracts({ vendorId, ...filters }),
  })
}

export function useVendorContractDetail(id: string, vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorContracts.detail(id),
    queryFn: () => getVendorContractDetail(id, vendorId),
    enabled: !!id,
  })
}

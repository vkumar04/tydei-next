"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVendorContracts, getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import type { ContractStatus } from "@/lib/generated/prisma/client"

/**
 * Vendor contracts list. The result carries BOTH the requested page
 * (`contracts` / `total` / `hasMore`, narrowed by `status` + `search`)
 * and `portfolio` — server-computed counts, money, facilities and
 * status splits over the vendor's entire portfolio. Read hero/summary
 * numbers from `portfolio`, never by reducing `contracts`: that array
 * is a page, and reducing it under-reports (2026-07-27 "Total Value"
 * short by ~$20M on a 60-contract vendor).
 *
 * `pageSize` is forwarded so a surface that renders the list itself can
 * ask for more than the 20-row default; the action clamps it.
 *
 * `facilityId` is forwarded so the facility picker — whose options come
 * from the whole portfolio — narrows the query rather than the already
 * capped rows in hand; filtering a page client-side would show nothing
 * for a facility the picker itself offered.
 */
export function useVendorContracts(
  vendorId: string,
  filters?: {
    status?: ContractStatus | "all"
    search?: string
    facilityId?: string
    pageSize?: number
  }
) {
  return useQuery({
    queryKey: queryKeys.vendorContracts.list(vendorId, filters),
    queryFn: () => getVendorContracts({ vendorId, ...filters }),
    // The portfolio rollup is identical for every status tab, so hold the
    // previous result while a tab switch refetches rather than blanking
    // the hero back to skeletons on each click.
    placeholderData: keepPreviousData,
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

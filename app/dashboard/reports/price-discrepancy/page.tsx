import { HydrationBoundary, dehydrate } from "@tanstack/react-query"
import { getQueryClient } from "@/lib/query/get-query-client"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancies } from "@/lib/actions/reports"
import { PriceDiscrepancyClient } from "./price-discrepancy-client"

// Server prefetches the discrepancies on this request, ships dehydrated
// state to the client, and the client's useQuery rehydrates without an
// extra round-trip. First paint shows data instead of a Skeleton.
export default async function PriceDiscrepancyPage() {
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: queryKeys.reports.priceDiscrepancies("current"),
    queryFn: () => getPriceDiscrepancies("current"),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PriceDiscrepancyClient />
    </HydrationBoundary>
  )
}

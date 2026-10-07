import { Suspense } from "react"
import { requireFacility } from "@/lib/actions/auth"
import { RenewalsClient } from "@/components/facility/renewals/renewals-client"
import RenewalsLoading from "./loading"

/**
 * Facility renewals list page.
 *
 * Server component — validates the caller is a facility user (redirects
 * to /login otherwise), then hands the client orchestrator the facility
 * id plus the current user id (used to scope Notes delete actions).
 *
 * Suspense wraps the client so TanStack Query hydration flashes the
 * loading skeleton rather than an empty shell. All data fetches are
 * deferred to client-side React Query — keeping the page itself tiny.
 */
export default async function RenewalsPage() {
  const { facility, user } = await requireFacility()

  return (
    <Suspense fallback={<RenewalsLoading />}>
      <RenewalsClient facilityId={facility.id} currentUserId={user.id} />
    </Suspense>
  )
}

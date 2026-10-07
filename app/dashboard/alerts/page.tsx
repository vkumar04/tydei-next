import { Suspense } from "react"

import { requireFacility } from "@/lib/actions/auth"
import { AlertsListClient } from "@/components/shared/alerts/alerts-list-client"

import AlertsLoading from "./loading"

export default async function AlertsPage() {
  const session = await requireFacility()

  return (
    <Suspense fallback={<AlertsLoading />}>
      <AlertsListClient facilityId={session.facility.id} />
    </Suspense>
  )
}

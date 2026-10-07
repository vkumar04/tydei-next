import { Suspense } from "react"

import { requireFacility } from "@/lib/actions/auth"
import { AlertDetailClient } from "@/components/shared/alerts/alert-detail-client"

import AlertDetailLoading from "./loading"

interface AlertDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AlertDetailPage({
  params,
}: AlertDetailPageProps) {
  await requireFacility()
  const { id } = await params

  return (
    <Suspense fallback={<AlertDetailLoading />}>
      <AlertDetailClient alertId={id} />
    </Suspense>
  )
}

import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

export default function VendorMarketShareLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <Skeleton className="h-[300px] w-full rounded" />
        </Card>
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <Skeleton className="h-[300px] w-full rounded" />
        </Card>
      </div>
    </div>
  )
}

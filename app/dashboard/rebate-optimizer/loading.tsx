import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

export default function RebateOptimizerLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <Card className="p-6">
        <Skeleton className="mb-4 h-5 w-32" />
        <Skeleton className="h-[300px] w-full rounded" />
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-4 h-2 w-full rounded-full" />
            <Skeleton className="mt-3 h-3 w-40" />
            <Skeleton className="mt-2 h-8 w-full rounded-md" />
          </Card>
        ))}
      </div>
    </div>
  )
}

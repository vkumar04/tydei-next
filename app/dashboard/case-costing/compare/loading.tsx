import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

export default function CompareLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
      </div>

      <Skeleton className="h-9 w-64 rounded-md" />

      <Card className="p-6">
        <Skeleton className="mb-4 h-5 w-32" />
        <Skeleton className="h-[300px] w-full rounded" />
      </Card>
    </div>
  )
}

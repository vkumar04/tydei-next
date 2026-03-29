import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

export default function ProspectiveLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <Card className="p-6">
        <div className="flex flex-col items-center gap-4 py-8">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-7 w-20" />
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <Skeleton className="h-[250px] w-full rounded" />
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-9 w-64" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

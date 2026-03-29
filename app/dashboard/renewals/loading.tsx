import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

export default function RenewalsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
            <Skeleton className="mt-4 h-2 w-full rounded-full" />
            <Skeleton className="mt-2 h-3 w-40" />
          </Card>
        ))}
      </div>
    </div>
  )
}

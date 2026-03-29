import { Skeleton } from "@/components/ui/skeleton"

export default function PODetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
      <Skeleton className="h-[300px] rounded-xl" />
    </div>
  )
}

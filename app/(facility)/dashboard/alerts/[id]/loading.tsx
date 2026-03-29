import { Skeleton } from "@/components/ui/skeleton"

export default function AlertDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[300px] rounded-xl" />
    </div>
  )
}

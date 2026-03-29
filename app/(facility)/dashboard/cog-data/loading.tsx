import { Skeleton } from "@/components/ui/skeleton"

export default function COGDataLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-[400px] w-full rounded-md" />
    </div>
  )
}

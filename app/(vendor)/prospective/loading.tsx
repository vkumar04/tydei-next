import { Skeleton } from "@/components/ui/skeleton"

export default function ProspectiveLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-[300px] w-full rounded-md" />
    </div>
  )
}

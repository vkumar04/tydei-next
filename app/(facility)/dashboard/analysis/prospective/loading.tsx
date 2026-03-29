import { Skeleton } from "@/components/ui/skeleton"

export default function ProspectiveLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-[200px] w-full rounded-xl" />
    </div>
  )
}

import { Skeleton } from "@/components/ui/skeleton"

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-10 w-full max-w-lg" />
      <Skeleton className="h-[250px] rounded-xl" />
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  )
}

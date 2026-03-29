import { Skeleton } from "@/components/ui/skeleton"

export default function VendorContractDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[400px] rounded-xl" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
      <Skeleton className="h-[200px] rounded-xl" />
    </div>
  )
}

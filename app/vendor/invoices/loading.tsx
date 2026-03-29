import { Skeleton } from "@/components/ui/skeleton"

export default function VendorInvoicesLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  )
}

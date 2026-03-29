import { Skeleton } from "@/components/ui/skeleton"

export default function InvoiceDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  )
}

import { Skeleton } from "@/components/ui/skeleton"

export default function InvoiceValidationLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  )
}

"use client"

import { BellOff } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"

export function AlertsListLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  )
}

export function AlertsListEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <BellOff className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <h3 className="font-semibold text-lg">No alerts</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs">{message}</p>
    </div>
  )
}

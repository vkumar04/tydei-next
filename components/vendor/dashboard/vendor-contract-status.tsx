"use client"

import { FileText } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface VendorContractStatusProps {
  data: { active: number; pending: number; expired: number }
}

export function VendorContractStatus({ data }: VendorContractStatusProps) {
  const hasContracts = data.active + data.pending + data.expired > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Status</CardTitle>
        <CardDescription>Distribution of your contracts</CardDescription>
      </CardHeader>
      <CardContent>
        {hasContracts ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Active</span>
              <span className="font-medium text-green-600">{data.active}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Pending</span>
              <span className="font-medium text-yellow-600">
                {data.pending}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Expired</span>
              <span className="font-medium text-muted-foreground">
                {data.expired}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-[200px] text-center">
            <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No contracts</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Contract status will appear here
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

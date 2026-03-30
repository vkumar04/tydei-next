"use client"

import { FileText, ArrowUpRight, Plus } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface RecentContract {
  id: string
  name: string
  status: string
  facilityName: string
}

interface VendorRecentContractsProps {
  data: RecentContract[]
}

export function VendorRecentContracts({ data }: VendorRecentContractsProps) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Contracts</CardTitle>
          <CardDescription>Your latest contract activity</CardDescription>
        </div>
        <Link href="/vendor/contracts">
          <Button variant="outline" size="sm">
            View All
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="space-y-4">
            {data.map((contract) => (
              <div
                key={contract.id}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div>
                  <p className="font-medium">{contract.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {contract.facilityName} - {contract.status}
                  </p>
                </div>
                <Link href={`/vendor/contracts/${contract.id}`}>
                  <Button variant="ghost" size="sm">
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-[200px] text-center">
            <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No contracts yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
              Your contract activity will appear here once contracts are created
            </p>
            <Link href="/vendor/contracts">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                View Contracts
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

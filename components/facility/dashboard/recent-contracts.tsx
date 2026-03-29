"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { contractStatusConfig } from "@/lib/constants"
import { formatDate } from "@/lib/formatting"
import type { Contract, Vendor } from "@prisma/client"

type ContractWithVendor = Contract & { vendor: Pick<Vendor, "id" | "name" | "logoUrl"> }

const typeLabels: Record<string, string> = {
  usage: "Usage",
  capital: "Capital",
  service: "Service",
  tie_in: "Tie-In",
  grouped: "Grouped",
  pricing_only: "Pricing Only",
}

interface RecentContractsProps {
  contracts: ContractWithVendor[]
}

export function RecentContracts({ contracts }: RecentContractsProps) {
  if (contracts.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Contracts</CardTitle>
            <CardDescription>Latest contract activity and status</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/contracts">
              View all
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <p>No contracts available</p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/dashboard/contracts/new">Create your first contract</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Contracts</CardTitle>
          <CardDescription>Latest contract activity and status</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/contracts">
            View all
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/contracts/${c.id}`}
                    className="font-medium hover:underline"
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.vendor.name}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {typeLabels[c.contractType ?? ""] ?? c.contractType ?? "Usage"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={c.status} config={contractStatusConfig} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {c.expirationDate ? formatDate(c.expirationDate) : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

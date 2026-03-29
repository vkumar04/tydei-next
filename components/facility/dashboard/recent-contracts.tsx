"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { contractStatusConfig } from "@/lib/constants"
import { formatDate, formatCurrency } from "@/lib/formatting"
import type { Contract, Vendor } from "@prisma/client"

type ContractWithVendor = Contract & { vendor: Pick<Vendor, "id" | "name" | "logoUrl"> }

interface RecentContractsProps {
  contracts: ContractWithVendor[]
}

export function RecentContracts({ contracts }: RecentContractsProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Recent Contracts</CardTitle>
        <Link href="/dashboard/contracts" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link href={`/dashboard/contracts/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>{c.vendor.name}</TableCell>
                <TableCell>
                  <StatusBadge status={c.status} config={contractStatusConfig} />
                </TableCell>
                <TableCell className="text-right">{formatCurrency(Number(c.totalValue))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

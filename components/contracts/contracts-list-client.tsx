"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Plus, FileText, DollarSign, TrendingUp } from "lucide-react"
import type { ContractStatus, ContractType } from "@prisma/client"
import { useContracts, useContractStats, useDeleteContract } from "@/hooks/use-contracts"
import { formatCurrency } from "@/lib/formatting"
import { PageHeader } from "@/components/shared/page-header"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { getContractColumns } from "@/components/contracts/contract-columns"
import { ContractFilters } from "@/components/contracts/contract-filters"
import { PendingContractsTab } from "@/components/facility/contracts/pending-contracts-tab"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ContractsListClientProps {
  facilityId: string
  userId?: string
}

export function ContractsListClient({ facilityId, userId }: ContractsListClientProps) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "all">("all")
  const [typeFilter, setTypeFilter] = useState<ContractType | "all">("all")
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const filters = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(typeFilter !== "all" && { type: typeFilter }),
  }

  const { data, isLoading } = useContracts(facilityId, filters)
  const { data: stats } = useContractStats(facilityId)
  const deleteMutation = useDeleteContract()

  const columns = useMemo(
    () =>
      getContractColumns({
        onView: (id) => router.push(`/dashboard/contracts/${id}`),
        onEdit: (id) => router.push(`/dashboard/contracts/${id}/edit`),
        onDelete: (contract) =>
          setDeleteTarget({ id: contract.id, name: contract.name }),
      }),
    [router]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="Manage your vendor contracts and agreements"
        action={
          <Button onClick={() => router.push("/dashboard/contracts/new")}>
            <Plus className="size-4" /> New Contract
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          title="Total Contracts"
          value={stats?.totalContracts ?? 0}
          icon={FileText}
          description="Active and pending"
        />
        <MetricCard
          title="Total Value"
          value={formatCurrency(stats?.totalValue ?? 0)}
          icon={DollarSign}
          description="All contracts"
        />
        <MetricCard
          title="Total Rebates"
          value={formatCurrency(stats?.totalRebates ?? 0)}
          icon={TrendingUp}
          description="Rebates earned"
        />
      </div>

      <Tabs defaultValue="contracts">
        <TabsList>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="pending">Pending Submissions</TabsTrigger>
        </TabsList>
        <TabsContent value="contracts" className="mt-4">
          <DataTable
            columns={columns}
            data={data?.contracts ?? []}
            searchKey="name"
            searchPlaceholder="Search contracts..."
            isLoading={isLoading}
            filterComponent={
              <ContractFilters
                status={statusFilter}
                onStatusChange={setStatusFilter}
                type={typeFilter}
                onTypeChange={setTypeFilter}
              />
            }
          />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <PendingContractsTab facilityId={facilityId} userId={userId ?? ""} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Contract"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMutation.mutateAsync(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        isLoading={deleteMutation.isPending}
        variant="destructive"
      />
    </div>
  )
}

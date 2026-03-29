"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { DataTable } from "@/components/shared/tables/data-table"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2 } from "lucide-react"
import { formatDate } from "@/lib/formatting"
import { toggleReportSchedule, deleteReportSchedule } from "@/lib/actions/report-scheduling"
import { queryKeys } from "@/lib/query-keys"
import type { ColumnDef } from "@tanstack/react-table"

interface Schedule {
  id: string
  reportType: string
  frequency: string
  emailRecipients: string[]
  isActive: boolean
  lastSentAt: string | null
  createdAt: string
}

interface ScheduleTableProps {
  schedules: Schedule[]
  facilityId: string
  onEdit: (schedule: Schedule) => void
}

export function ScheduleTable({ schedules, facilityId, onEdit }: ScheduleTableProps) {
  const qc = useQueryClient()

  const toggleMut = useMutation({
    mutationFn: toggleReportSchedule,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.reportSchedules.list(facilityId) }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteReportSchedule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.reportSchedules.list(facilityId) }); toast.success("Schedule deleted") },
  })

  const columns: ColumnDef<Schedule>[] = [
    {
      accessorKey: "reportType",
      header: "Report",
      cell: ({ row }) => <span className="capitalize">{row.original.reportType.replace("_", " ")}</span>,
    },
    {
      accessorKey: "frequency",
      header: "Frequency",
      cell: ({ row }) => <Badge variant="outline" className="capitalize">{row.original.frequency}</Badge>,
    },
    {
      accessorKey: "emailRecipients",
      header: "Recipients",
      cell: ({ row }) => row.original.emailRecipients.join(", "),
    },
    {
      accessorKey: "isActive",
      header: "Active",
      cell: ({ row }) => (
        <Switch
          checked={row.original.isActive}
          onCheckedChange={() => toggleMut.mutate(row.original.id)}
          disabled={toggleMut.isPending}
        />
      ),
    },
    {
      accessorKey: "lastSentAt",
      header: "Last Sent",
      cell: ({ row }) => row.original.lastSentAt ? formatDate(row.original.lastSentAt) : "Never",
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => onEdit(row.original) },
            { label: "Delete", icon: Trash2, onClick: () => deleteMut.mutate(row.original.id), variant: "destructive" },
          ]}
        />
      ),
    },
  ]

  return <DataTable columns={columns} data={schedules} />
}

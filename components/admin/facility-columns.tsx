"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Building2, CheckCircle, XCircle } from "lucide-react"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2, Users } from "lucide-react"
import type { AdminFacilityRow } from "@/lib/actions/admin/facilities"
import { formatDate } from "@/lib/formatting"

export function getFacilityColumns(
  onEdit: (facility: AdminFacilityRow) => void,
  onDelete: (facility: AdminFacilityRow) => void,
  onManageUsers: (facility: AdminFacilityRow) => void
): ColumnDef<AdminFacilityRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Facility",
      meta: { filterVariant: "text", filterLabel: "Facility" },
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      id: "location",
      header: "Location",
      meta: { filterVariant: "text", filterLabel: "Location" },
      accessorFn: (row) => {
        const { city, state } = row
        return city && state ? `${city}, ${state}` : (city ?? state ?? "")
      },
      cell: ({ row }) => {
        const { city, state } = row.original
        return (
          <span className="text-muted-foreground">
            {city && state ? `${city}, ${state}` : city ?? state ?? "\u2014"}
          </span>
        )
      },
    },
    {
      id: "status",
      /**
       * Checked on 2026-07-28 against the vendor console, where the equivalent
       * columns were rewritten, and KEPT — `Facility.status` is the one
       * `@default` on either console that a real writer moves.
       * lib/billing/stripe-webhook.ts sets it to "inactive" on
       * `customer.subscription.deleted` and on any non-active subscription
       * update, so "Inactive" here means a specific thing: the subscription
       * lapsed. (Contrast `Vendor.tier`, which no write path sets at all, and
       * `Vendor.status`, which bulk ingestion leaves at the default for every
       * auto-minted row.)
       *
       * What "Active" does NOT mean is that anyone reviewed this facility: with
       * no Stripe subscription the row is born active and stays there — both
       * production facilities read Active for that reason. The badge says so
       * rather than leaving the operator to infer it.
       *
       * accessorFn, not accessorKey: the "select" filter builds its options
       * from the column's ACTUAL values (getFacetedUniqueValues,
       * column-filter.tsx:128). Keyed on `status` it listed the raw enum,
       * "active"/"inactive", beside cells reading "Active"/"Inactive" — the
       * filter and the rows disagreeing about their own labels. Deriving the
       * rendered label makes the list and the cells the same strings. Note the
       * options are still faceted over the rows the client HOLDS, i.e. one
       * server page; the caption under the table says so.
       */
      accessorFn: (f) => (f.status === "active" ? "Active" : "Inactive"),
      header: "Status",
      meta: { filterVariant: "select" },
      cell: ({ getValue }) =>
        getValue<string>() === "Active" ? (
          <Badge
            variant="default"
            title="The Stripe subscription is active — or the facility has no subscription and was never flipped off the @default(&quot;active&quot;)."
          >
            <CheckCircle className="mr-1 h-3 w-3" /> Active
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            title="The Stripe subscription was cancelled or is no longer active."
          >
            <XCircle className="mr-1 h-3 w-3" /> Inactive
          </Badge>
        ),
    },
    {
      accessorKey: "userCount",
      header: () => <div className="text-right">Users</div>,
      meta: { filterVariant: "range", filterLabel: "Users" },
      cell: ({ row }) => <div className="text-right">{row.original.userCount}</div>,
    },
    {
      accessorKey: "contractCount",
      header: () => <div className="text-right">Contracts</div>,
      meta: { filterVariant: "range", filterLabel: "Contracts" },
      cell: ({ row }) => <div className="text-right">{row.original.contractCount}</div>,
    },
    {
      accessorKey: "createdAt",
      header: () => <div className="text-right">Created</div>,
      meta: { filterVariant: "none" },
      cell: ({ row }) => (
        <div className="text-right text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </div>
      ),
    },
    {
      id: "actions",
      meta: { filterVariant: "none" },
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => onEdit(row.original) },
            { label: "Manage Users", icon: Users, onClick: () => onManageUsers(row.original) },
            { label: "Delete", icon: Trash2, onClick: () => onDelete(row.original), variant: "destructive" },
          ]}
        />
      ),
    },
  ]
}

"use client"

import type { ColumnDef } from "@/components/shared/tables/table-features"
import { Badge } from "@/components/ui/badge"
import { Building2, CheckCircle, XCircle } from "lucide-react"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2, Users } from "lucide-react"
import type { AdminVendorRow } from "@/lib/actions/admin/vendors"
import { formatDate } from "@/lib/formatting"

export function getAdminVendorColumns(
  onEdit: (vendor: AdminVendorRow) => void,
  onDelete: (vendor: AdminVendorRow) => void
): ColumnDef<AdminVendorRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Vendor",
      meta: { filterVariant: "text", filterLabel: "Vendor" },
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
      id: "tier",
      /**
       * Charles 2026-07-28: the same defect as the Status column below, one
       * column over — a schema default rendered as though somebody chose it.
       *
       * Verified before changing anything, not assumed. `Vendor.tier` is
       * `VendorTier @default(standard)` (prisma/schema.prisma:612) and NO
       * application write path produces anything else:
       *   lib/actions/vendors.ts createVendor  writes `tier: data.tier`, and all
       *                                        three call sites hard-code
       *                                        "standard" (cog-import-dialog,
       *                                        new-contract-client,
       *                                        _basic-information-card — plus
       *                                        settings/tabs/vendors-tab, which
       *                                        appends `tier: "standard"`).
       *   lib/actions/vendors.ts updateVendor  writes tier only when supplied;
       *                                        no caller supplies it.
       *   admin{Create,Update}Vendor           spread the form input, and the
       *                                        admin form has no tier control.
       *   lib/vendors/resolve.ts               auto-mints vendors from imports
       *                                        and never touches tier.
       * Production agrees: 199 of 200 vendors are "standard". The lone
       * "premium" is Stryker, written by hand on 2026-04-07, before any of the
       * paths above existed.
       *
       * So the badge was labelling every row with an unsettable default, under
       * the header "Category" — which `VendorTier` (standard | premium) has
       * never been. Worse was the faceted select filter beside it: its options
       * come from the rows the CLIENT holds, i.e. one server page, and page 1
       * of production is 20 standard vendors — a filter offering exactly one
       * choice that matches every row, which is the shape just removed from
       * Status. `filterVariant: "none"` for that reason.
       *
       * What survives is the part that carries information: an explicit
       * promotion off the default. Everything else reads "—" rather than
       * dressing `@default(standard)` up as a decision.
       */
      accessorFn: (v) => (v.tier === "standard" ? "" : v.tier),
      header: "Tier",
      meta: { filterVariant: "none" },
      cell: ({ row }) =>
        row.original.tier === "standard" ? (
          <span
            className="text-muted-foreground"
            title="Standard is the schema default. No screen in the app sets a vendor tier, so this is “never promoted”, not “reviewed and left standard”."
          >
            &mdash;
          </span>
        ) : (
          <Badge variant="default" className="capitalize">
            {row.original.tier}
          </Badge>
        ),
    },
    {
      id: "status",
      /**
       * Charles 2026-07-28: "it says these are all active but only the ASFD is."
       *
       * He is right, and the badge was not lying so much as reporting a column
       * that means nothing here. `Vendor.status` is `@default("active")` and
       * bulk ingestion never sets it, so every vendor auto-minted from a COG /
       * PO / invoice file is born "Active" — 201 of 201 in production.
       *
       * The column that actually separates a real tenant from an import
       * artifact is `organizationId`: without an Organization there are no
       * Members, so nobody can sign in. Lead with that (`canHaveUsers`), and
       * keep the raw status only when it carries real information — an
       * explicitly deactivated vendor.
       *
       * This is an accessorFn, NOT accessorKey: the "select" filter builds its
       * options from the column's ACTUAL values via getFacetedUniqueValues
       * (column-filter.tsx:128). Keyed on `status` it offered exactly one
       * choice — "active" — matching all 201 rows while the cells beside it read
       * "Onboarded" / "Catalog only". Deriving the value makes the filter list
       * the three labels that are actually rendered, so filtering and display
       * agree.
       */
      accessorFn: (v) =>
        v.status !== "active"
          ? "Inactive"
          : v.canHaveUsers
            ? "Onboarded"
            : "Catalog only",
      header: "Status",
      meta: { filterVariant: "select" },
      cell: ({ getValue }) => {
        const label = getValue<string>()
        if (label === "Inactive") {
          return (
            <Badge variant="secondary">
              <XCircle className="mr-1 h-3 w-3" /> Inactive
            </Badge>
          )
        }
        return label === "Onboarded" ? (
          <Badge variant="default">
            <CheckCircle className="mr-1 h-3 w-3" /> Onboarded
          </Badge>
        ) : (
          <Badge variant="outline" title="Created from an imported file — no organization, so it has no users and nobody can sign in.">
            Catalog only
          </Badge>
        )
      },
    },
    {
      accessorKey: "repCount",
      header: () => <div className="text-right">Reps</div>,
      meta: { filterVariant: "range", filterLabel: "Reps" },
      cell: ({ row }) => (
        <div className="text-right">{row.original.repCount}</div>
      ),
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
            { label: "Manage Reps", icon: Users, onClick: () => {} },
            { label: "Delete", icon: Trash2, onClick: () => onDelete(row.original), variant: "destructive" },
          ]}
        />
      ),
    },
  ]
}

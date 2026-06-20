"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/shared/tables/data-table"
import {
  getVendorContractColumns,
  type ContractWithFacility,
} from "./vendor-contract-columns"
import { VendorContractsHero } from "./vendor-contracts-hero"
import {
  VendorContractsControlBar,
  type VendorStatusTab,
} from "./vendor-contracts-control-bar"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import {
  useVendorPendingContracts,
  useDeletePendingContract,
} from "@/hooks/use-pending-contracts"
import { resolveLastActionAt } from "./last-action"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { ContractStatus } from "@/lib/generated/prisma/client"

interface VendorContractListProps {
  vendorId: string
}

const EXPIRING_SOON_WINDOW_DAYS = 30

export function VendorContractList({ vendorId }: VendorContractListProps) {
  const router = useRouter()
  const [statusTab, setStatusTab] = useState<VendorStatusTab>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  // Bug-bash 2026-06-11 B2: confirm-before-delete target. Only pending
  // submissions can land here (the Delete action is gated in the
  // columns); active Contract rows never offer Delete.
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const deleteMutation = useDeletePendingContract()

  // Always fetch the full set for hero stats + facility options
  const { data: allData } = useVendorContracts(vendorId, { status: undefined })
  const allContracts = allData?.contracts ?? []

  // Fetch pending contracts from the PendingContract table
  const { data: pendingData, isLoading: pendingLoading } =
    useVendorPendingContracts(vendorId)
  const pendingContracts = pendingData ?? []

  // Map pending contracts to match the Contract table row shape.
  // Charles 2026-06-10 ("pending, active, rejected tabs not populating"):
  // previously only `submitted` rows were mapped (status forced to
  // "pending"), and the Rejected tab returned a hardcoded []. Map EVERY
  // submission except `approved` (those already exist as real Contract
  // rows) and keep the PendingContract status string so the badge and the
  // tab filters below can tell submitted / rejected / revision_requested /
  // withdrawn apart.
  const mappedPending = useMemo(
    () =>
      pendingContracts
        .filter((pc) => pc.status !== "approved")
        .map((pc) => ({
          id: pc.id,
          name: pc.contractName,
          contractNumber: null,
          vendorId: pc.vendorId,
          facilityId: pc.facilityId ?? null,
          contractType: pc.contractType,
          // PendingContract statuses are rendered by StatusBadge, which
          // tolerates non-ContractStatus strings via contractStatusConfig.
          status: pc.status as unknown as ContractStatus,
          effectiveDate: pc.effectiveDate ? new Date(pc.effectiveDate) : new Date(),
          expirationDate: pc.expirationDate ? new Date(pc.expirationDate) : new Date(),
          totalValue: pc.totalValue ?? 0,
          annualValue: null,
          description: null,
          createdAt: new Date(pc.submittedAt),
          updatedAt: new Date(pc.submittedAt),
          productCategoryId: null,
          facility: pc.facility
            ? { id: pc.facility.id, name: pc.facility.name }
            : null,
          productCategory: null,
          pendingStatus: pc.status,
          // bugs.rtfd 2026-06-11 B4: "Last Action" = the facility's
          // review decision if one happened, else the submission time.
          lastActionAt: resolveLastActionAt({
            kind: "pending",
            reviewedAt: pc.reviewedAt,
            submittedAt: pc.submittedAt,
          }),
        })),
    [pendingContracts],
  )

  const { data, isLoading: contractsLoading } = useVendorContracts(vendorId, {
    status:
      statusTab === "all" || statusTab === "submitted" || statusTab === "rejected"
        ? undefined
        : (statusTab as ContractStatus),
  })

  const rawContractRows = data?.contracts ?? []

  // bugs.rtfd 2026-06-11 B4: real Contract rows carry no persisted
  // status-change timestamp, so "Last Action" is Prisma's @updatedAt —
  // the last time anything acted on the row (approval created it;
  // edits touch it). Resolved here at the mapping boundary, not in
  // the column cell.
  const rawContracts = useMemo(
    () =>
      rawContractRows.map((c) => ({
        ...c,
        lastActionAt: resolveLastActionAt({
          kind: "contract",
          updatedAt: c.updatedAt,
        }),
      })),
    [rawContractRows],
  )

  // Merge contracts with pending depending on the active status filter.
  // Contract-table statuses (active / draft / pending) are filtered
  // server-side; PendingContract submissions are filtered here by their
  // real status so every tab populates.
  const mergedContracts = useMemo(() => {
    const pendingWith = (...statuses: string[]) =>
      mappedPending.filter((pc) => statuses.includes(pc.pendingStatus))
    switch (statusTab) {
      case "all":
        return [...rawContracts, ...mappedPending]
      case "draft":
        return [...rawContracts, ...pendingWith("draft")]
      case "submitted":
        return pendingWith("submitted")
      case "pending":
        // Awaiting facility action: submitted + revision-requested
        // submissions, plus any Contract rows in `pending` status.
        return [...rawContracts, ...pendingWith("submitted", "revision_requested")]
      case "rejected":
        return pendingWith("rejected")
      default:
        return rawContracts
    }
  }, [statusTab, rawContracts, mappedPending])

  // Apply facility + search filters on the client. The merged set blends
  // serialized Contract rows with hand-mapped PendingContract rows; both
  // satisfy the display-only fields the columns read, so we narrow to the
  // shared row shape at this single boundary (replaces the old `as any`).
  const contracts = useMemo((): ContractWithFacility[] => {
    const q = searchQuery.trim().toLowerCase()
    const rows = mergedContracts.filter((c) => {
      if (facilityFilter !== "all" && c.facility?.id !== facilityFilter) {
        return false
      }
      if (q.length > 0) {
        const hay = [
          c.name,
          c.contractNumber ?? "",
          c.facility?.name ?? "",
        ]
          .join(" ")
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return rows as unknown as ContractWithFacility[]
  }, [mergedContracts, facilityFilter, searchQuery])

  const isLoading = contractsLoading || pendingLoading

  // Shared by the "View Details" menu action AND the whole-row click
  // (bug-bash 2026-06-11 B2: rows weren't clickable into detail).
  const handleView = (id: string) => {
    const isPending = mappedPending.some((pc) => pc.id === id)
    if (isPending) {
      // Review F1 (2026-06-10): /vendor/contracts/pending/[id] has no detail
      // page — only [id]/edit exists. Route there so pending rows (now
      // including rejected / revision_requested / draft after the tabs fix)
      // don't 404; the edit page doubles as the submission's detail view.
      router.push(`/vendor/contracts/pending/${id}/edit`)
    } else {
      router.push(`/vendor/contracts/${id}`)
    }
  }

  const columns = getVendorContractColumns(handleView, (row) =>
    setDeleteTarget(row),
  )

  // --- Hero stats ---------------------------------------------------------
  // Derived from the full (unfiltered) data set + pending so the hero is
  // stable as the user narrows the table below.
  const activeCount = allContracts.filter((c) => c.status === "active").length
  const pendingReviewCount = mappedPending.filter(
    (pc) =>
      pc.pendingStatus === "submitted" ||
      pc.pendingStatus === "revision_requested",
  ).length
  const totalValue = allContracts.reduce(
    (sum, c) => sum + Number(c.totalValue ?? 0),
    0,
  )
  const facilitiesServed = useMemo(() => {
    const ids = new Set<string>()
    for (const c of allContracts) {
      if (c.facility?.id) ids.add(c.facility.id)
    }
    for (const c of mappedPending) {
      if (c.facility?.id) ids.add(c.facility.id)
    }
    return ids.size
  }, [allContracts, mappedPending])
  const expiringSoon = useMemo(() => {
    const now = Date.now()
    const cutoff = now + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000
    return allContracts.filter((c) => {
      if (c.status !== "active") return false
      const exp = c.expirationDate ? new Date(c.expirationDate).getTime() : 0
      return exp >= now && exp <= cutoff
    }).length
  }, [allContracts])

  // Facility options across the full set so filtering works regardless of tab
  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of allContracts) {
      if (c.facility?.id) map.set(c.facility.id, c.facility.name)
    }
    for (const c of mappedPending) {
      if (c.facility?.id) map.set(c.facility.id, c.facility.name)
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [allContracts, mappedPending])

  return (
    <div className="space-y-6">
      <VendorContractsHero
        // Review F5 (2026-06-10): rejected/withdrawn submissions are
        // browsable in their tabs but don't count as portfolio contracts.
        totalContracts={
          allContracts.length +
          mappedPending.filter(
            (pc) =>
              pc.pendingStatus === "draft" ||
              pc.pendingStatus === "submitted" ||
              pc.pendingStatus === "revision_requested",
          ).length
        }
        activeCount={activeCount}
        facilitiesServed={facilitiesServed}
        totalValue={totalValue}
        pendingReview={pendingReviewCount}
        expiringSoon={expiringSoon}
        isLoading={isLoading && allContracts.length === 0}
      />

      <VendorContractsControlBar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        facilityFilter={facilityFilter}
        onFacilityFilterChange={setFacilityFilter}
        facilities={facilityOptions}
        statusTab={statusTab}
        onStatusTabChange={setStatusTab}
      />

      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
          <CardDescription>
            {contracts.length} contract{contracts.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={contracts}
            isLoading={isLoading}
            enableColumnFilters
            // Bug-bash 2026-06-11 B2: whole row clicks through to the
            // contract detail (active) or submission edit page (pending).
            // Menu buttons inside the row stopPropagation in the columns.
            onRowClick={(row) => handleView(row.id)}
          />
        </CardContent>
      </Card>

      {/* Bug-bash 2026-06-11 B2: destructive confirm before deleting a
          submission. Mirrors bundle-delete-button.tsx. */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this submission?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will be permanently removed.
              This cannot be undone. Active contracts are never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (!deleteTarget) return
                deleteMutation.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                  onError: () => setDeleteTarget(null),
                })
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

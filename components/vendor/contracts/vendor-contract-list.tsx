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

/**
 * Rows requested per call for the table below. The DataTable paginates
 * client-side, so it needs the matching rows in hand — but the request
 * is still capped (the action clamps harder), and when the cap bites,
 * the card header says so rather than silently showing a slice.
 */
const CONTRACT_LIST_PAGE_SIZE = 200

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

  // ONE query serves both halves of this page: `data.contracts` is the
  // (filtered, capped) table page, `data.portfolio` is the vendor's whole
  // portfolio rolled up server-side for the hero + facility filter.
  const { data, isLoading: contractsLoading } = useVendorContracts(vendorId, {
    status:
      statusTab === "all" || statusTab === "submitted" || statusTab === "rejected"
        ? undefined
        : (statusTab as ContractStatus),
    // Server-side, because the picker's options come from the whole
    // portfolio while these rows are capped: filtering them in the client
    // would leave a facility selectable but empty. `total` / `hasMore`
    // below then describe the selected facility too, not all facilities.
    facilityId: facilityFilter,
    pageSize: CONTRACT_LIST_PAGE_SIZE,
  })

  const portfolio = data?.portfolio
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

  // Apply facility + search filters on the client. Contract rows were
  // already narrowed to `facilityFilter` server-side (this pass is a
  // no-op for them); it is the PendingContract rows — fetched whole, not
  // paginated — that still need filtering here. Search stays client-side
  // for both, which is why the card header names the row cap: a term that
  // only matches an unloaded contract cannot be found.
  //
  // The merged set blends serialized Contract rows with hand-mapped
  // PendingContract rows; both satisfy the display-only fields the columns
  // read, so we narrow to the shared row shape at this single boundary
  // (replaces the old `as any`).
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
  // Every number below describes ONE population: the vendor's executed
  // Contract rows (counted / summed / grouped server-side over the whole
  // portfolio, never over `rawContractRows` — that's a page) plus the
  // in-flight submissions. Review F5 (2026-06-10): rejected and withdrawn
  // submissions stay browsable in their tabs but are not portfolio.
  //
  // Charles 2026-07-27: these used to be reduced over the 20-row first
  // page, so "Total Value" under-reported by roughly $20M for a
  // 60-contract vendor and the facility filter was missing every facility
  // whose contracts hadn't been touched lately.
  const inFlightPending = useMemo(
    () =>
      mappedPending.filter(
        (pc) =>
          pc.pendingStatus === "draft" ||
          pc.pendingStatus === "submitted" ||
          pc.pendingStatus === "revision_requested",
      ),
    [mappedPending],
  )

  const pendingReviewCount = mappedPending.filter(
    (pc) =>
      pc.pendingStatus === "submitted" ||
      pc.pendingStatus === "revision_requested",
  ).length

  const totalContracts = (portfolio?.contractCount ?? 0) + inFlightPending.length
  // Money and count come from the same population, so the two hero tiles
  // can't disagree: portfolio sum (server `_sum`) + the same in-flight rows
  // that the count above includes.
  const totalValue =
    (portfolio?.totalValue ?? 0) +
    inFlightPending.reduce((sum, pc) => sum + Number(pc.totalValue ?? 0), 0)
  const activeCount = portfolio?.activeCount ?? 0
  const expiringSoon = portfolio?.expiringSoonCount ?? 0

  const facilitiesServed = useMemo(() => {
    const ids = new Set<string>(
      (portfolio?.facilities ?? []).map((f) => f.id),
    )
    for (const pc of inFlightPending) {
      if (pc.facility?.id) ids.add(pc.facility.id)
    }
    return ids.size
  }, [portfolio, inFlightPending])

  // Facility options over the vendor's WHOLE portfolio (server-side
  // distinct list) plus every submission's facility — including rejected
  // ones, whose rows are reachable on the Rejected tab and must stay
  // filterable. Built from a page of rows, this dropdown silently omitted
  // older facilities.
  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of portfolio?.facilities ?? []) map.set(f.id, f.name)
    for (const c of mappedPending) {
      if (c.facility?.id) map.set(c.facility.id, c.facility.name)
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [portfolio, mappedPending])

  return (
    <div className="space-y-6">
      <VendorContractsHero
        totalContracts={totalContracts}
        activeCount={activeCount}
        facilitiesServed={facilitiesServed}
        totalValue={totalValue}
        pendingReview={pendingReviewCount}
        expiringSoon={expiringSoon}
        // Every hero number blends the server rollup with the in-flight
        // submissions, so it is only true once BOTH queries have landed.
        // `isLoading && !portfolio` rendered a hero missing the whole
        // submissions population whenever the rollup resolved first —
        // a total short by its second half, presented as final.
        // `keepPreviousData` keeps this false across tab/facility
        // switches, so the hero still doesn't blank while refetching.
        isLoading={isLoading}
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
            {/* "Rows", not "contracts": this count is the merged, searched
                set — Contract rows plus submissions — while `data.total`
                beside it counts Contract rows only. Different populations,
                so they get different nouns instead of reading as one
                number contradicting the other. */}
            {contracts.length} {contracts.length === 1 ? "row" : "rows"} shown
            {/* A cap that stays must be visible. `hasMore` means the server
                trimmed the result set, so name the trim instead of passing
                a slice off as the whole list. "this view" = the status tab
                AND the facility pick, both of which narrow `total` too. The
                hero above is unaffected — it is a server-side rollup of the
                entire portfolio. */}
            {data?.hasMore
              ? ` · only the ${rawContractRows.length} most recently updated of ${data.total} contracts in this view are loaded, so older ones are missing from these rows and from the search above`
              : ""}
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

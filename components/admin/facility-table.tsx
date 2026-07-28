"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query"
import { toast } from "sonner"
import { Building2, CheckCircle, Users, FileText, Plus, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { getFacilityColumns } from "./facility-columns"
import { FacilityFormDialog } from "./facility-form-dialog"
import {
  describeAdminTablePage,
  describeAdminTableControlScope,
} from "./admin-table-page-summary"
import {
  adminGetFacilities,
  adminCreateFacility,
  adminUpdateFacility,
  adminDeleteFacility,
  type AdminFacilityRow,
} from "@/lib/actions/admin/facilities"
import type { AdminCreateFacilityInput } from "@/lib/validators/admin"
import { queryKeys } from "@/lib/query-keys"

const FACILITY_NOUN = ["facility", "facilities"] as const
const SEARCH_DEBOUNCE_MS = 250

export function FacilityTable() {
  const qc = useQueryClient()
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminFacilityRow | null>(null)
  const [deleting, setDeleting] = useState<AdminFacilityRow | null>(null)

  /**
   * Server-driven paging + search, identical to the Vendors console. Facilities
   * happen to fit inside one page today (2 in production, 8 in the dev seed),
   * which is exactly why the missing pager went unnoticed on this side — the
   * same reason `adminGetFacilityOptions` exists. Do not rely on that staying
   * true: an enterprise health system onboarding lands dozens at once.
   */
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchQueryChange = useCallback((next: string) => {
    setSearchQuery(next)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setSearchTerm(next.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  const filters = { page, search: searchTerm }
  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.admin.facilities(filters),
    queryFn: () => adminGetFacilities(filters),
    placeholderData: keepPreviousData,
  })

  // Charles 2026-06-20: these admin mutations had only onSuccess. A failing
  // server action (validation, duplicate, or a requireAdmin redirect-throw)
  // surfaced as an UNHANDLED rejection — which Next escalates to its error
  // boundary, the "pages time out and switch randomly" symptom. Surface
  // failures as toasts so the operator stays on the page.
  const onMutationError = (verb: string) => (err: unknown) =>
    toast.error(err instanceof Error ? err.message : `Failed to ${verb} facility`)

  // Family prefix, not this page's key — a create/delete moves `total` and so
  // every page, and must also refresh the Access picker's `facilityOptions()`
  // list (see lib/query-keys.ts for why that only prefix-matches now).
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.admin.facilitiesBase })

  const createMut = useMutation({
    mutationFn: (input: AdminCreateFacilityInput) => adminCreateFacility(input),
    onSuccess: () => { invalidate(); setFormOpen(false); toast.success("Facility created") },
    onError: onMutationError("create"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminCreateFacilityInput }) => adminUpdateFacility(id, input),
    onSuccess: () => { invalidate(); setEditing(null); toast.success("Facility updated") },
    onError: onMutationError("update"),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFacility(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success("Facility deleted") },
    onError: onMutationError("delete"),
  })

  const columns = getFacilityColumns(
    (f) => setEditing(f),
    (f) => setDeleting(f),
    // "Manage Users" was a dead no-op; route the operator to user management.
    () => router.push("/admin/users"),
  )

  const facilities = data?.facilities ?? []
  // The server clamps `page`; read it back rather than trusting local state.
  const currentPage = data?.page ?? 1
  const pageCount = data?.pageCount ?? 1

  /**
   * EVERY card below reads a server-side total over the WHOLE facility catalog.
   * None of them reduce over `facilities` (one page), and none of them narrow
   * to the search box — see vendor-table.tsx for both rounds of that defect.
   * The search-scoped count belongs in the page range under the table, which
   * names it and the catalog side by side.
   *
   * "Active" was re-checked on 2026-07-28 against the vendor console's dropped
   * Active card and KEPT. `Facility.status` is `@default("active")` like
   * `Vendor.status`, but unlike it the column has a real writer:
   * lib/billing/stripe-webhook.ts flips a facility to "inactive" on
   * `customer.subscription.deleted` and on any non-active subscription update.
   * (`Vendor.tier`, one column over in vendor-columns.tsx, has no writer at
   * all, which is why that one did not survive.) The caveat — a facility with
   * no Stripe subscription is born active and stays there — is on the Status
   * badge in facility-columns.tsx, where the operator reads the value.
   *
   * Renders "—" until the query resolves: a placeholder 0 is also a wrong
   * number under a confident label.
   */
  const stat = (value: number | undefined) => value ?? "—"

  /**
   * Both sentences come from the server response that produced the rows;
   * neither counts the array on screen.
   */
  const summary = data
    ? describeAdminTablePage({
        rowCount: facilities.length,
        page: currentPage,
        pageSize: data.pageSize,
        total: data.total,
        catalogTotal: data.catalogTotal,
        // The search the server ECHOED — `keepPreviousData` can still be
        // showing the previous search's rows.
        search: data.search,
        noun: FACILITY_NOUN,
      })
    : null
  const controlScope = data
    ? describeAdminTableControlScope({
        rowCount: facilities.length,
        pageCount,
        catalogTotal: data.catalogTotal,
        noun: FACILITY_NOUN,
      })
    : null

  return (
    <>
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                {/* `catalogTotal`, not `total` — see vendor-table.tsx. */}
                <p className="text-2xl font-bold">{stat(data?.catalogTotal)}</p>
                <p className="text-xs text-muted-foreground">Total Facilities</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-5 w-5 text-green-700 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat(data?.activeTotal)}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="h-5 w-5 text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat(data?.userTotal)}</p>
                <p className="text-xs text-muted-foreground">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                <FileText className="h-5 w-5 text-purple-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat(data?.contractTotal)}</p>
                <p className="text-xs text-muted-foreground">Total Contracts</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        No `searchKey` and no client pager — the search runs in Postgres over
        every facility in scope and the page boundary is the server's. See the
        Vendors console for the failure mode both avoid.
      */}
      <DataTable
        columns={columns}
        data={facilities}
        isLoading={isLoading}
        pagination={false}
        enableColumnFilters
        filterComponent={
          <>
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search all facilities..."
                aria-label="Search all facilities"
                value={searchQuery}
                onChange={(e) => handleSearchQueryChange(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button size="sm" className="gap-2" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> Add Facility
            </Button>
          </>
        }
      />

      {summary && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm text-muted-foreground">{summary}</p>
            {controlScope && (
              <p className="text-xs text-muted-foreground">{controlScope}</p>
            )}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Page {currentPage.toLocaleString()} of {pageCount.toLocaleString()}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1 || isFetching}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
                disabled={currentPage >= pageCount || isFetching}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
      <FacilityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={async (d) => { try { await createMut.mutateAsync(d) } catch { /* surfaced via onError toast */ } }}
        isSubmitting={createMut.isPending}
      />
      {editing && (
        <FacilityFormDialog
          facility={{ id: editing.id, name: editing.name, type: editing.type as AdminCreateFacilityInput["type"], status: editing.status }}
          open={!!editing}
          onOpenChange={() => setEditing(null)}
          onSubmit={async (d) => { try { await updateMut.mutateAsync({ id: editing.id, input: d }) } catch { /* surfaced via onError toast */ } }}
          isSubmitting={updateMut.isPending}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Facility"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        onConfirm={async () => { if (deleting) { try { await deleteMut.mutateAsync(deleting.id) } catch { /* surfaced via onError toast */ } } }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

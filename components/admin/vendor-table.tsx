"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { getAdminVendorColumns } from "./vendor-columns"
import {
  describeAdminTablePage,
  describeAdminTableControlScope,
} from "./admin-table-page-summary"
import {
  adminGetVendors,
  adminCreateVendor,
  adminUpdateVendor,
  adminDeleteVendor,
  type AdminVendorRow,
} from "@/lib/actions/admin/vendors"
import type { AdminCreateVendorInput } from "@/lib/validators/admin"
import { queryKeys } from "@/lib/query-keys"

const VENDOR_NOUN = ["vendor", "vendors"] as const
/** Same debounce as the contracts list, so the query key never re-keys per keystroke. */
const SEARCH_DEBOUNCE_MS = 250

export function VendorTable() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminVendorRow | null>(null)
  const [deleting, setDeleting] = useState<AdminVendorRow | null>(null)
  const [formData, setFormData] = useState<Partial<AdminCreateVendorInput>>({})

  /**
   * `page` and `searchTerm` are the only things the client owns; pageSize,
   * pageCount and the clamped page all come back off the response, so there is
   * one definition of "a page" and it lives on the server.
   *
   * `searchQuery` is what the input shows; `searchTerm` is what the SERVER is
   * filtering on (debounced) — two states rather than one because the query key
   * must not re-key on every keystroke. Same shape as
   * components/contracts/contracts-list-client.tsx.
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
      // A narrower result set must not strand the operator on page 9.
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
    queryKey: queryKeys.admin.vendors(filters),
    queryFn: () => adminGetVendors(filters),
    // Keep the current page on screen while the next one loads, so paging and
    // typing don't flash an empty table.
    placeholderData: keepPreviousData,
  })

  // Charles 2026-06-20: surface admin mutation failures as toasts instead of
  // unhandled rejections (the "add a vendor … times out / switches pages"
  // symptom).
  const onMutationError = (verb: string) => (err: unknown) =>
    toast.error(err instanceof Error ? err.message : `Failed to ${verb} vendor`)

  /**
   * The family prefix, not this page's key: a create/delete changes `total` and
   * therefore every page, and it must also refresh the Access picker's
   * unpaginated `vendorOptions()` list — which only prefix-matches because
   * `vendorsBase` is the bare 2-element array (see lib/query-keys.ts).
   */
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.admin.vendorsBase })

  const createMut = useMutation({
    mutationFn: (input: AdminCreateVendorInput) => adminCreateVendor(input),
    onSuccess: () => { invalidate(); setFormOpen(false); toast.success("Vendor created") },
    onError: onMutationError("create"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminCreateVendorInput }) => adminUpdateVendor(id, input),
    onSuccess: () => { invalidate(); setEditing(null); toast.success("Vendor updated") },
    onError: onMutationError("update"),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteVendor(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success("Vendor deleted") },
    onError: onMutationError("delete"),
  })

  const columns = getAdminVendorColumns(
    (v) => { setEditing(v); setFormData({ name: v.name, code: v.code ?? "", contactName: v.contactName ?? "", contactEmail: v.contactEmail ?? "" }) },
    (v) => setDeleting(v)
  )

  const handleSubmit = async () => {
    const input = formData as AdminCreateVendorInput
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, input })
      } else {
        await createMut.mutateAsync(input)
      }
    } catch { /* surfaced via onError toast */ }
  }

  const vendors = data?.vendors ?? []
  /**
   * The server clamps `page` into range, so read it back rather than trusting
   * local state — deleting the last vendor on the last page otherwise leaves
   * the pager pointing at a page that no longer exists.
   */
  const currentPage = data?.page ?? 1
  const pageCount = data?.pageCount ?? 1

  /**
   * EVERY card below reads a server-side total over the WHOLE vendor catalog.
   * None of them reduce over `vendors` (one page), and none of them narrow to
   * the search box either — a card labelled "Total Vendors" answers "how many
   * vendors are there", which is a question the search box does not change.
   *
   * Three passes, because the scope kept moving one level closer without
   * arriving: the row first read "20 Total Vendors" against 200 real rows;
   * 2026-07-27 fixed only the first card, putting a true 200 beside a Sales
   * Reps and Total Contracts still summed over 20; 2026-07-28 moved all four to
   * the server but computed them inside the search, so typing "stryker" made
   * the row read "1 / 1 / 0 / 1" under four unqualified "Total …" labels. The
   * search-scoped count has exactly one home — the page range below the table,
   * which names both numbers ("of 1 vendor matching “stryker” (of 200 total)").
   *
   * "Active" has no card on purpose: `status` is `@default("active")` that
   * ingestion never sets, so it reports 200 of 200. "Onboarded" — active AND
   * organization-backed, therefore able to hold users — is what separates a
   * real tenant from an import artifact, and is the same set the Status column
   * badges "Onboarded" rather than a looser reading of the same word.
   *
   * Renders "—" until the query resolves: a placeholder 0 is also a wrong
   * number under a confident label.
   */
  const stat = (value: number | undefined) => value ?? "—"

  /**
   * The rows are ONE server page. Until 2026-07-28 they were the ONLY server
   * page — ranks 21–200 of production's 200 vendors, "Stryker" (rank 176, one
   * of two live production contracts) among them, could not be reached from
   * this console at all. Both sentences below come from the server response
   * that produced the rows; neither counts the array on screen.
   */
  const summary = data
    ? describeAdminTablePage({
        rowCount: vendors.length,
        page: currentPage,
        pageSize: data.pageSize,
        total: data.total,
        catalogTotal: data.catalogTotal,
        // The search the server ECHOED, not `searchTerm`: while the next
        // request is in flight `keepPreviousData` still shows the previous
        // rows, and the label has to describe those.
        search: data.search,
        noun: VENDOR_NOUN,
      })
    : null
  const controlScope = data
    ? describeAdminTableControlScope({
        rowCount: vendors.length,
        pageCount,
        catalogTotal: data.catalogTotal,
        noun: VENDOR_NOUN,
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
                {/*
                  `catalogTotal`, not `total`: `total` is what the SEARCH
                  matched, and a card reading "1" under "Total Vendors" because
                  someone typed a name is the same wrong-scope defect as the
                  page sums it replaced. The search's count lives in the range
                  sentence under the table.
                */}
                <p className="text-2xl font-bold">{stat(data?.catalogTotal)}</p>
                <p className="text-xs text-muted-foreground">Total Vendors</p>
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
                <p className="text-2xl font-bold">{stat(data?.onboardedTotal)}</p>
                <p className="text-xs text-muted-foreground">Onboarded</p>
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
                {/*
                  Was `vendors.filter(v => v.contactName).length` over the page:
                  page-scoped, and counting a different quantity than the "Reps"
                  column beside it (which is divisions). `repTotal` is that same
                  column summed across every vendor, so card and column agree.
                */}
                <p className="text-2xl font-bold">{stat(data?.repTotal)}</p>
                <p className="text-xs text-muted-foreground">Sales Reps</p>
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
        No `searchKey`: the box below searches in Postgres over every vendor in
        scope. DataTable's built-in search filters the ROWS IT HOLDS, which is
        one page — typing "stryker" on page 1 of 10 found nothing and said "No
        results found." Likewise `pagination={false}`: the page boundary is the
        server's, and a second client-side pager on top of it would page a page.
      */}
      <DataTable
        columns={columns}
        data={vendors}
        isLoading={isLoading}
        pagination={false}
        enableColumnFilters
        filterComponent={
          <>
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search all vendors..."
                aria-label="Search all vendors"
                value={searchQuery}
                onChange={(e) => handleSearchQueryChange(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button size="sm" className="gap-2" onClick={() => { setFormData({}); setFormOpen(true) }}>
              <Plus className="size-4" /> Add Vendor
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
      <FormDialog
        open={formOpen || !!editing}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setEditing(null) } }}
        title={editing ? "Edit Vendor" : "Add New Vendor"}
        description={editing ? "Modify vendor details" : "Add a new vendor organization to the platform"}
        onSubmit={handleSubmit}
        isSubmitting={createMut.isPending || updateMut.isPending}
      >
        <Field label="Vendor Name" required>
          <Input value={formData.name ?? ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter vendor name" />
        </Field>
        <Field label="Code">
          <Input value={formData.code ?? ""} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., STR" />
        </Field>
        <Field label="Contact Name">
          <Input value={formData.contactName ?? ""} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} placeholder="Primary contact name" />
        </Field>
        <Field label="Contact Email">
          <Input value={formData.contactEmail ?? ""} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} placeholder="admin@vendor.com" />
        </Field>
      </FormDialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Vendor"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        onConfirm={async () => { if (deleting) { try { await deleteMut.mutateAsync(deleting.id) } catch { /* surfaced via onError toast */ } } }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}

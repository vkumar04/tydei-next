"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2, Building2, Search } from "lucide-react"
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { getVendorList, createVendor, updateVendor, deactivateVendor } from "@/lib/actions/vendors"
import { VENDOR_PAGE_SIZE } from "@/lib/validators/vendors"
import { queryKeys } from "@/lib/query-keys"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

/**
 * The sentence under the table. It exists because this screen used to show
 * `pageSize: 100` rows out of a 200-vendor catalog with no pager and no count:
 * everything from rank 101 (KOVEN) to 200 (Zimmer US, Inc.) was unreachable,
 * including "Stryker" at rank 176, which holds a live contract. A truncation
 * the UI cannot see is the bug — so every number below comes from the server
 * response that produced the rows, never from `vendors.length`.
 */
export function describeVendorPage(input: {
  /** Rows actually rendered right now (the page). */
  rowCount: number
  /** Page the server served, 1-based. */
  page: number
  pageSize: number
  /** Rows matching the active search, across ALL pages. */
  total: number
  /** Rows in the whole catalog, ignoring the search. */
  catalogTotal: number
  search: string
}): string {
  const { rowCount, page, pageSize, total, catalogTotal } = input
  const search = input.search.trim()
  const noun = total === 1 ? "vendor" : "vendors"

  if (total === 0) {
    return search
      ? `No vendors match “${search}” — searched all ${catalogTotal.toLocaleString()} vendors.`
      : "No vendors yet."
  }

  if (rowCount === 0) {
    // `total` says rows exist but this page holds none — rows were deleted
    // between the server's count and its read. Say so, rather than deriving a
    // backwards range ("Showing 26–25") from two disagreeing numbers.
    return `No vendors on page ${page.toLocaleString()} — ${total.toLocaleString()} ${noun} in total.`
  }

  const first = (page - 1) * pageSize + 1
  const last = first + rowCount - 1
  const range = `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`

  return search
    ? `${range} matching “${search}” (of ${catalogTotal.toLocaleString()} total)`
    : range
}

export function VendorsTab() {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [code, setCode] = useState("")
  const [division, setDivision] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  const qc = useQueryClient()
  const filters = { search, page, pageSize: VENDOR_PAGE_SIZE }
  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.vendors.list(filters),
    queryFn: () => getVendorList(filters),
    // Keep the previous page on screen while the next one loads, so paging
    // doesn't flash an empty table.
    placeholderData: keepPreviousData,
  })

  const mutationError = (verb: string) => (err: unknown) =>
    // Surface the server's reason — the duplicate-name guard in `createVendor`
    // names the vendor that already exists, which is the whole point of it.
    toast.error(err instanceof Error ? err.message : `Failed to ${verb} vendor`)

  const createMut = useMutation({
    mutationFn: createVendor,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.vendors.all }); toast.success("Vendor created"); closeDialog() },
    onError: mutationError("create"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: Parameters<typeof updateVendor>[1] }) => updateVendor(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.vendors.all }); toast.success("Vendor updated"); closeDialog() },
    onError: mutationError("update"),
  })

  const deactivateMut = useMutation({
    mutationFn: deactivateVendor,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.vendors.all }); toast.success("Vendor deactivated") },
    onError: mutationError("deactivate"),
  })

  function closeDialog() {
    setAddOpen(false)
    setEditId(null)
    setName("")
    setDisplayName("")
    setCode("")
    setDivision("")
    setContactName("")
    setContactEmail("")
  }

  function openEdit(v: { id: string; name: string; displayName?: string | null; code?: string | null; division?: string | null; contactName?: string | null; contactEmail?: string | null }) {
    setEditId(v.id)
    setName(v.name)
    setDisplayName(v.displayName ?? "")
    setCode(v.code ?? "")
    setDivision(v.division ?? "")
    setContactName(v.contactName ?? "")
    setContactEmail(v.contactEmail ?? "")
    setAddOpen(true)
  }

  function handleSave() {
    if (!name.trim()) { toast.error("Vendor name is required"); return }
    const payload = { name, displayName: displayName || undefined, code: code || undefined, division: division || undefined, contactName: contactName || undefined, contactEmail: contactEmail || undefined }
    if (editId) {
      updateMut.mutate({ id: editId, data: payload })
    } else {
      createMut.mutate({ ...payload, tier: "standard" as const })
    }
  }

  const vendors = data?.vendors ?? []
  // Every count below is the server's, over the same `where` that produced the
  // rows. `vendors.length` is the size of ONE page and must never stand in for
  // any of them.
  const total = data?.total ?? 0
  const catalogTotal = data?.catalogTotal ?? total
  // The server clamps `page` into range, so read it back rather than trusting
  // local state — otherwise deactivating the last row on the last page leaves
  // the label pointing at a page that no longer exists.
  const currentPage = data?.page ?? page
  const pageCount = data?.pageCount ?? 1
  // Until the first response lands there is no count to quote. `catalogTotal`
  // falls back to 0, and "0 vendors in the catalog" is a made-up number wearing
  // an authoritative label — so quote nothing instead.
  const catalogCount = data ? catalogTotal.toLocaleString() : null
  const summary = describeVendorPage({
    rowCount: vendors.length,
    page: currentPage,
    pageSize: data?.pageSize ?? VENDOR_PAGE_SIZE,
    total,
    catalogTotal,
    // The server echoes the search it applied. While the next keystroke's page
    // is in flight `keepPreviousData` still shows the previous rows, and the
    // label has to describe THOSE rows — not the search that hasn't landed yet.
    search: data?.search ?? "",
  })

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Vendors
            </CardTitle>
            {/*
              The count beside this label is the whole `Vendor` table: the model
              has no owning-tenant column and `getVendorList` applies no facility
              clause, so "connected to your facility" described a narrower scope
              than the number (and than the rows) ever came from. The label now
              names the scope it is actually counting.
            */}
            <CardDescription>
              {catalogCount
                ? `Shared vendor catalog — ${catalogCount} vendors`
                : "Shared vendor catalog"}
            </CardDescription>
          </div>
          <Button onClick={() => { closeDialog(); setAddOpen(true) }}>
            <Plus className="h-4 w-4" /> Add Vendor
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search all vendors..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="max-w-sm"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : vendors.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{summary}</TableCell></TableRow>
              ) : vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{v.displayName || v.name}</p>
                      {v.displayName && <p className="text-xs text-muted-foreground">{v.name}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{v.code ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{v.division ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{v.contactName ?? "—"}</TableCell>
                  <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deactivateMut.mutate(v.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isLoading && vendors.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{summary}</p>
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
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
            <DialogDescription>
              {editId
                ? "Enter vendor details"
                : catalogCount
                  ? `Search the ${catalogCount} existing vendors first — duplicate names split a vendor's COG matching across two rows.`
                  : "Search the existing vendors first — duplicate names split a vendor's COG matching across two rows."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" /></div>
              <div className="space-y-1"><Label>Display Name</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g., STK" /></div>
              <div className="space-y-1"><Label>Division</Label><Input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="e.g., Orthopaedics" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Contact Name</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Contact Email</Label><Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} type="email" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

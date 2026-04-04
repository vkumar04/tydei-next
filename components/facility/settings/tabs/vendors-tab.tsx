"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2, Building2, Search } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getVendorList, createVendor, updateVendor, deactivateVendor } from "@/lib/actions/vendors"
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

export function VendorsTab() {
  const [search, setSearch] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [code, setCode] = useState("")
  const [division, setDivision] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendors.list({ search }),
    queryFn: () => getVendorList({ search, page: 1, pageSize: 100 }),
  })

  const createMut = useMutation({
    mutationFn: createVendor,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.vendors.all }); toast.success("Vendor created"); closeDialog() },
    onError: () => toast.error("Failed to create vendor"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: Parameters<typeof updateVendor>[1] }) => updateVendor(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.vendors.all }); toast.success("Vendor updated"); closeDialog() },
    onError: () => toast.error("Failed to update vendor"),
  })

  const deactivateMut = useMutation({
    mutationFn: deactivateVendor,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.vendors.all }); toast.success("Vendor deactivated") },
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

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Vendors
            </CardTitle>
            <CardDescription>Manage vendors connected to your facility</CardDescription>
          </div>
          <Button onClick={() => { closeDialog(); setAddOpen(true) }}>
            <Plus className="h-4 w-4" /> Add Vendor
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search vendors..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
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
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No vendors found</TableCell></TableRow>
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
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
            <DialogDescription>Enter vendor details</DialogDescription>
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

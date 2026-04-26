"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2, Tag, FolderTree } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getCategories, createCategory, updateCategory, deleteCategory } from "@/lib/actions/categories"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export function CategoriesTab() {
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const qc = useQueryClient()
  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  })

  const createMut = useMutation({
    mutationFn: createCategory,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Category created"); closeDialog() },
    onError: () => toast.error("Failed to create category"),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; description?: string } }) => updateCategory(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Category updated"); closeDialog() },
    onError: () => toast.error("Failed to update category"),
  })

  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Category deleted") },
  })

  function closeDialog() {
    setAddOpen(false)
    setEditId(null)
    setName("")
    setDescription("")
  }

  function openEdit(c: { id: string; name: string }) {
    setEditId(c.id)
    setName(c.name)
    setDescription("")
    setAddOpen(true)
  }

  function handleSave() {
    if (!name.trim()) { toast.error("Category name is required"); return }
    if (editId) {
      updateMut.mutate({ id: editId, data: { name, description: description || undefined } })
    } else {
      createMut.mutate({ name, description: description || undefined })
    }
  }

  const cats = categories ?? []

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FolderTree className="h-5 w-5" /> Product Categories
            </CardTitle>
            <CardDescription>Manage product categories for contracts and pricing</CardDescription>
          </div>
          <Button onClick={() => { closeDialog(); setAddOpen(true) }}>
            <Plus className="h-4 w-4" /> Add Category
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : cats.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No categories yet. Add your first category.</TableCell></TableRow>
              ) : cats.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate(c.id)}><Trash2 className="h-3 w-3" /></Button>
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
            <DialogTitle>{editId ? "Edit Category" : "Add Category"}</DialogTitle>
            <DialogDescription>Enter category details</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Orthopedics" /></div>
            <div className="space-y-1"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" /></div>
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
